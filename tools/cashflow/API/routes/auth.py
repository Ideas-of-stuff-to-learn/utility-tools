"""
routes/auth.py

Login, signup, refresh, logout, and "who am I" (/auth/me - used by
both the app's role badge and the CLI's "what am I allowed to do").
Token issuing/expiry/revocation lives here; the actual permission
system (roles, permission checks) lives in permissions.py and
routes/admin.py.
"""
from datetime import datetime, timezone, timedelta
import os

from flask import request, jsonify
from flask_jwt_extended import (
    jwt_required, get_jwt_identity, get_jwt,
    create_access_token, create_refresh_token, decode_token,
    set_access_cookies, set_refresh_cookies, unset_jwt_cookies, get_csrf_token
)
import bcrypt

from extensions import app, limiter
from hmac_auth import derive_signing_secret
from rate_limits import (
    RL_AUTH_ME, RL_AUTH_LOGIN, RL_AUTH_SIGNUP, RL_AUTH_REFRESH,
    RL_ADMIN_SENSITIVE, RL_AUTH_EMAIL_SEND, RL_AUTH_FORGOT_PASSWORD,
    RL_AUTH_CHANGE_PASSWORD, RL_AUTH_CANCEL_DELETION,
)
from database import get_connection, release_connection
from permissions import get_user_role_and_permissions, user_has_permission
from email_service import send_email

FRONTEND_BASE_URL = os.environ.get('FRONTEND_BASE_URL', 'http://localhost:5173')
_EMAIL_TOKEN_MINUTES = 5
_EMAIL_DAILY_CAP = 5
_EMAIL_COOLDOWN_SECONDS = 60
# Exponential lockout thresholds:
#   >= 5  attempts  → 15-min timed lock
#   >= 10 attempts  → 60-min timed lock
#   >= 15 attempts  → permanent lock (login_locked_until = year 9999 sentinel)
#                     only an admin+ unlock clears it
_LOGIN_TIER1_ATTEMPTS = 5
_LOGIN_TIER2_ATTEMPTS = 10
_LOGIN_TIER3_ATTEMPTS = 15
_LOGIN_TIER1_MINUTES  = 15
_LOGIN_TIER2_MINUTES  = 60
_LOGIN_PERMANENT_SENTINEL = '9999-01-01 00:00:00+00'


@app.route('/auth/me', methods=['GET'])
@jwt_required()
@limiter.limit(RL_AUTH_ME)
def auth_me():
    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, email, display_name, email_verified, pending_email FROM users WHERE id = %s",
                (current_user,)
            )
            row = cur.fetchone()
        username = row[0] if row else None
        email = row[1] if row else None
        display_name = row[2] if row else None
        email_verified = row[3] if row else False
        pending_email = row[4] if row else None
        role_name, level, perms = get_user_role_and_permissions(conn, current_user)
        return jsonify({
            'username': username,
            'email': email,
            'email_verified': email_verified,
            'pending_email': pending_email,
            'display_name': display_name,
            'role': role_name,
            'level': level,
            'permissions': sorted(perms),
            'csrf_access_token': get_csrf_token(request.cookies.get('access_token_cookie')),
            'csrf_refresh_token': get_csrf_token(request.cookies.get('refresh_token_cookie')),
        }), 200
    except Exception as e:
        app.logger.error(f'Fetching own identity failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to fetch account info'}), 500
    finally:
        release_connection(conn)
        
        
def get_user_by_username(conn, username):
    """Returns (id, password_hash) for a username, or None if not found."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, password_hash FROM users WHERE username = %s", (username,))
        row = cur.fetchone()
        return row if row else None


def get_user_by_email(conn, email):
    """Returns (id, password_hash) for an email address, or None if not found."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, password_hash FROM users WHERE email = %s", (email.lower(),))
        row = cur.fetchone()
        return row if row else None


def username_exists(conn, username):
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE username = %s", (username,))
        return cur.fetchone() is not None


def email_exists(conn, email):
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email.lower(),))
        return cur.fetchone() is not None


def validate_email(email):
    """Returns an error message string, or None if valid."""
    if not email:
        return 'Email cannot be empty'
    if '@' not in email or '.' not in email.split('@')[-1]:
        return 'Enter a valid email address'
    if len(email) > 254:
        return 'Email address is too long'
    return None


def create_user(conn, username, password_hash, email=None):
    """Inserts a new user and returns the new integer id. Assigned the
    'user' role immediately at creation time - NOT left NULL to be
    picked up by schema.sql's backfill later, since that backfill only
    runs when schema.sql is re-executed (a fresh deploy/DB recreation),
    not on every signup. A brand new signup should never have a NULL
    role_id even for the moment before some unrelated migration script
    next happens to run."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO users (username, password_hash, role_id, email, display_name)
               VALUES (%s, %s, (SELECT id FROM roles WHERE name = 'user'), %s, %s)
               RETURNING id""",
            (username, password_hash, email.lower() if email else None, username),
        )
        new_id = cur.fetchone()[0]
    conn.commit()
    return new_id

# ── Email action token helpers ────────────────────────────────────────────────

def _make_action_token(user_id, action, new_email=None):
    """Create a short-lived JWT for email verification or password reset."""
    extra = {'action': action}
    if new_email:
        extra['new_email'] = new_email
    return create_access_token(
        identity=str(user_id),
        expires_delta=timedelta(minutes=_EMAIL_TOKEN_MINUTES),
        additional_claims=extra,
    )


def _decode_action_token(token_str, expected_action):
    """Decode and validate an action token. Returns (user_id, claims) or raises ValueError."""
    try:
        decoded = decode_token(token_str)
    except Exception as e:
        raise ValueError(f'Invalid or expired token')
    if decoded.get('action') != expected_action:
        raise ValueError('Invalid token type')
    return int(decoded['sub']), decoded


def _check_email_ratelimit(conn, user_id):
    """Returns None if OK, 'daily_limit', or 'cooldown:<seconds>' if throttled.
    Owner-role users bypass all limits via the email.bypass_ratelimit permission."""
    if user_has_permission(conn, user_id, 'email.bypass_ratelimit'):
        return None
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_email_sent_at, email_daily_count, email_daily_count_date FROM users WHERE id = %s",
            (user_id,)
        )
        row = cur.fetchone()
    if not row:
        return 'daily_limit'
    last_sent, daily_count, daily_date = row
    now = datetime.now(timezone.utc)
    if daily_date != now.date():
        daily_count = 0
    if daily_count >= _EMAIL_DAILY_CAP:
        return 'daily_limit'
    if last_sent:
        elapsed = (now - last_sent).total_seconds()
        if elapsed < _EMAIL_COOLDOWN_SECONDS:
            return f'cooldown:{int(_EMAIL_COOLDOWN_SECONDS - elapsed) + 1}'
    return None


def _increment_email_count(conn, user_id):
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE users SET
                 last_email_sent_at = now(),
                 email_daily_count = CASE
                     WHEN email_daily_count_date = CURRENT_DATE THEN COALESCE(email_daily_count, 0) + 1
                     ELSE 1
                 END,
                 email_daily_count_date = CURRENT_DATE
               WHERE id = %s""",
            (user_id,)
        )
    conn.commit()


def _check_one_time_token(conn, user_id, token_iat):
    """Returns True if the token is fresh (has not been used yet)."""
    with conn.cursor() as cur:
        cur.execute("SELECT last_token_used_at FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
    if not row:
        return False
    last_used = row[0]
    if last_used is None:
        return True
    token_issued = datetime.fromtimestamp(token_iat, tz=timezone.utc)
    return token_issued > last_used


def _mark_token_used(conn, user_id):
    with conn.cursor() as cur:
        cur.execute("UPDATE users SET last_token_used_at = now() WHERE id = %s", (user_id,))
    conn.commit()


def _email_html(heading, body_html, action_url, button_label):
    return f"""
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:8px">{heading}</h2>
  {body_html}
  <a href="{action_url}"
     style="display:inline-block;margin-top:16px;padding:12px 24px;
            background:#3D8B5F;color:#fff;text-decoration:none;border-radius:6px;
            font-weight:600">{button_label}</a>
  <p style="color:#999;font-size:12px;margin-top:24px;word-break:break-all">
    If the button doesn't work, copy this link: {action_url}
  </p>
</div>"""


# ── Email verification ────────────────────────────────────────────────────────

@app.route('/auth/send-verification', methods=['POST'])
@jwt_required()
@limiter.limit(RL_AUTH_EMAIL_SEND)
def send_verification():
    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT email, email_verified FROM users WHERE id = %s", (current_user,))
            row = cur.fetchone()
        if not row or not row[0]:
            return jsonify({'error': 'No email on your account. Add one via your profile first.'}), 400
        if row[1]:
            return jsonify({'error': 'Email is already verified'}), 400
        email = row[0]

        limit_err = _check_email_ratelimit(conn, current_user)
        if limit_err == 'daily_limit':
            return jsonify({'error': 'Daily email limit reached. Try again tomorrow.', 'code': 'daily_limit'}), 429
        if limit_err and limit_err.startswith('cooldown:'):
            secs = limit_err.split(':')[1]
            return jsonify({'error': f'Please wait {secs}s before requesting another email.', 'code': 'cooldown', 'retry_after': int(secs)}), 429

        token = _make_action_token(current_user, 'verify_email', new_email=email)
        verify_url = f"{FRONTEND_BASE_URL}/verify-email?token={token}"
        html = _email_html(
            'Verify your email address',
            f'<p style="color:#444">Click below to verify <strong>{email}</strong>. This link expires in {_EMAIL_TOKEN_MINUTES} minutes.</p>'
            f'<p style="color:#666;font-size:13px">If you didn\'t request this, ignore this email.</p>',
            verify_url,
            'Verify email',
        )
        send_email(email, 'Verify your email address', html)
        _increment_email_count(conn, current_user)
        return jsonify({'status': 'ok', 'message': 'Verification email sent'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'send_verification failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to send verification email'}), 500
    finally:
        release_connection(conn)


@app.route('/auth/verify-email', methods=['GET'])
@limiter.limit(RL_AUTH_EMAIL_SEND)
def verify_email():
    token_str = request.args.get('token', '')
    if not token_str:
        return jsonify({'error': 'Missing token', 'code': 'missing_token'}), 400
    try:
        user_id, claims = _decode_action_token(token_str, 'verify_email')
    except ValueError as e:
        return jsonify({'error': str(e), 'code': 'invalid_token'}), 400

    new_email = claims.get('new_email')
    if not new_email:
        return jsonify({'error': 'Invalid token', 'code': 'invalid_token'}), 400

    conn = get_connection()
    try:
        if not _check_one_time_token(conn, user_id, claims['iat']):
            return jsonify({'error': 'This verification link has already been used. Request a new one.', 'code': 'token_used'}), 400
        _mark_token_used(conn, user_id)
        # If this email matches pending_email, clear the pending state and promote it
        with conn.cursor() as cur:
            cur.execute("SELECT pending_email FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
        is_pending_change = row and row[0] and row[0].lower() == new_email.lower()
        with conn.cursor() as cur:
            if is_pending_change:
                cur.execute(
                    "UPDATE users SET email = %s, email_verified = true, pending_email = NULL WHERE id = %s",
                    (new_email.lower(), user_id)
                )
            else:
                cur.execute(
                    "UPDATE users SET email = %s, email_verified = true WHERE id = %s",
                    (new_email.lower(), user_id)
                )
        conn.commit()
        return jsonify({'status': 'ok', 'message': 'Email verified successfully'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'verify_email failed for user {user_id}: {e}')
        return jsonify({'error': 'Verification failed. Please try again.'}), 500
    finally:
        release_connection(conn)


# ── Password reset ────────────────────────────────────────────────────────────

@app.route('/auth/forgot-password', methods=['POST'])
@limiter.limit(RL_AUTH_FORGOT_PASSWORD)
def forgot_password():
    data = request.get_json() or {}

    # L3: honeypot — bots fill hidden fields, humans don't
    if data.get('website'):
        return jsonify({'status': 'ok'}), 200

    # L4: timing check — bot submissions arrive < 200ms after page load
    try:
        elapsed_ms = int(data.get('_elapsed_ms', 9999))
        if elapsed_ms < 200:
            return jsonify({'status': 'ok'}), 200
    except (ValueError, TypeError):
        pass

    email = (data.get('email') or '').strip().lower()
    # Always return the same response regardless of whether the email exists
    generic_ok = jsonify({'status': 'ok', 'message': "If that email is registered, you'll receive a reset link shortly."})

    if not email or '@' not in email:
        return generic_ok, 200

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (email,))
            row = cur.fetchone()
        if not row:
            return generic_ok, 200
        user_id = row[0]

        limit_err = _check_email_ratelimit(conn, user_id)
        if limit_err:
            return generic_ok, 200  # silently eat — don't reveal limit state to unauthenticated caller

        token = _make_action_token(user_id, 'reset_password')
        reset_url = f"{FRONTEND_BASE_URL}/reset-password?token={token}"
        html = _email_html(
            'Reset your password',
            '<p style="color:#444">Click below to set a new password. This link expires in '
            f'{_EMAIL_TOKEN_MINUTES} minutes.</p>'
            '<p style="color:#666;font-size:13px">If you didn\'t request this, ignore this email. Your password hasn\'t changed.</p>',
            reset_url,
            'Reset password',
        )
        send_email(email, 'Reset your password', html)
        _increment_email_count(conn, user_id)
        return generic_ok, 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'forgot_password failed: {e}')
        return generic_ok, 200
    finally:
        release_connection(conn)


@app.route('/auth/reset-password', methods=['POST'])
@limiter.limit(RL_AUTH_EMAIL_SEND)
def reset_password():
    data = request.get_json() or {}
    token_str = data.get('token', '')
    new_password = data.get('password', '')

    if not token_str:
        return jsonify({'error': 'Missing token'}), 400
    error = validate_password(new_password)
    if error:
        return jsonify({'error': error}), 400

    try:
        user_id, claims = _decode_action_token(token_str, 'reset_password')
    except ValueError as e:
        return jsonify({'error': str(e), 'code': 'invalid_token'}), 400

    conn = get_connection()
    try:
        if not _check_one_time_token(conn, user_id, claims['iat']):
            return jsonify({'error': 'This reset link has already been used. Request a new one.', 'code': 'token_used'}), 400
        _mark_token_used(conn, user_id)
        hashed = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt(rounds=12))
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hashed.decode('utf-8'), user_id))
        conn.commit()
        return jsonify({'status': 'ok', 'message': 'Password updated successfully'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'reset_password failed for user {user_id}: {e}')
        return jsonify({'error': 'Password reset failed. Please try again.'}), 500
    finally:
        release_connection(conn)


# ── Profile management ───────────────────────────────────────────────────────

@app.route('/auth/profile', methods=['PATCH'])
@jwt_required()
@limiter.limit(RL_AUTH_EMAIL_SEND)
def update_profile():
    current_user = int(get_jwt_identity())
    data = request.get_json() or {}
    display_name = data.get('display_name', '').strip() or None
    new_email = (data.get('email') or '').strip().lower() or None

    conn = get_connection()
    try:
        updates = []
        params = []

        if display_name is not None:
            if len(display_name) > 50:
                return jsonify({'error': 'Display name must be under 50 characters'}), 400
            updates.append("display_name = %s")
            params.append(display_name)

        if new_email is not None:
            err = validate_email(new_email)
            if err:
                return jsonify({'error': err}), 400
            # Check not already taken by another user
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE email = %s AND id != %s", (new_email, current_user))
                if cur.fetchone():
                    return jsonify({'error': 'An account with that email already exists'}), 409
            # Check rate limit before sending
            limit_err = _check_email_ratelimit(conn, current_user)
            if limit_err == 'daily_limit':
                return jsonify({'error': 'Daily email limit reached. Try again tomorrow.', 'code': 'daily_limit'}), 429
            if limit_err and limit_err.startswith('cooldown:'):
                secs = limit_err.split(':')[1]
                return jsonify({'error': f'Please wait {secs}s before requesting another email.', 'code': 'cooldown', 'retry_after': int(secs)}), 429
            updates.append("pending_email = %s")
            params.append(new_email)

        if not updates:
            return jsonify({'error': 'Nothing to update'}), 400

        params.append(current_user)
        with conn.cursor() as cur:
            cur.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = %s", params)
        conn.commit()

        if new_email is not None:
            token = _make_action_token(current_user, 'verify_email', new_email=new_email)
            verify_url = f"{FRONTEND_BASE_URL}/verify-email?token={token}"
            html = _email_html(
                'Verify your new email address',
                f'<p style="color:#444">You requested an email change to <strong>{new_email}</strong>. '
                f'Click below to confirm. This link expires in {_EMAIL_TOKEN_MINUTES} minutes.</p>'
                f'<p style="color:#666;font-size:13px">If you didn\'t request this, ignore this email. Your current address is unchanged.</p>',
                verify_url,
                'Verify new email',
            )
            send_email(new_email, 'Verify your new email address', html)
            _increment_email_count(conn, current_user)

        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'update_profile failed for user {current_user}: {e}')
        return jsonify({'error': 'Update failed'}), 500
    finally:
        release_connection(conn)


# ── Account deletion (soft delete with 48h reactivation window) ───────────────

@app.route('/auth/change-password', methods=['POST'])
@jwt_required()
@limiter.limit(RL_AUTH_CHANGE_PASSWORD)
def change_password():
    current_user = int(get_jwt_identity())
    data = request.get_json() or {}
    current_pw = data.get('current_password', '')
    new_pw = data.get('new_password', '')

    err = validate_password(new_pw)
    if err:
        return jsonify({'error': err}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM users WHERE id = %s", (current_user,))
            row = cur.fetchone()
        if not row or not row[0]:
            return jsonify({'error': 'No password set on this account'}), 400
        if not bcrypt.checkpw(current_pw.encode('utf-8'), row[0].encode('utf-8')):
            return jsonify({'error': 'Current password is incorrect'}), 401
        hashed = bcrypt.hashpw(new_pw.encode('utf-8'), bcrypt.gensalt(rounds=12))
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hashed.decode('utf-8'), current_user))
        conn.commit()
        return jsonify({'status': 'ok'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'change_password failed for user {current_user}: {e}')
        return jsonify({'error': 'Password change failed'}), 500
    finally:
        release_connection(conn)


@app.route('/auth/account', methods=['DELETE'])
@jwt_required(fresh=True)
@limiter.limit(RL_AUTH_CHANGE_PASSWORD)
def delete_account():
    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT email FROM users WHERE id = %s", (current_user,))
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'User not found'}), 404
        user_email = row[0]

        with conn.cursor() as cur:
            cur.execute("UPDATE users SET deleted_at = now() WHERE id = %s", (current_user,))
        conn.commit()

        if user_email:
            cancel_token = create_access_token(
                identity=str(current_user),
                expires_delta=timedelta(hours=48),
                additional_claims={'action': 'cancel_deletion'},
            )
            cancel_url = f"{FRONTEND_BASE_URL}/cancel-deletion?token={cancel_token}"
            html = _email_html(
                'Your account has been scheduled for deletion',
                '<p style="color:#444">Your account and all associated data will be permanently deleted in <strong>48 hours</strong>.</p>'
                '<p style="color:#444">Changed your mind? Click below to cancel the deletion and restore your account.</p>',
                cancel_url,
                'Cancel deletion',
            )
            try:
                send_email(user_email, 'Account deletion scheduled — act within 48 hours to cancel', html)
            except Exception:
                pass  # Don't fail the deletion if email can't send

        return jsonify({'status': 'ok', 'message': 'Account scheduled for deletion. Check your email to cancel within 48 hours.'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'delete_account failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to schedule account deletion'}), 500
    finally:
        release_connection(conn)


@app.route('/auth/cancel-deletion', methods=['POST'])
@limiter.limit(RL_AUTH_CANCEL_DELETION)
def cancel_deletion():
    data = request.get_json() or {}
    token_str = data.get('token', '')
    if not token_str:
        return jsonify({'error': 'Missing token', 'code': 'missing_token'}), 400
    try:
        user_id, claims = _decode_action_token(token_str, 'cancel_deletion')
    except ValueError as e:
        return jsonify({'error': str(e), 'code': 'invalid_token'}), 400

    conn = get_connection()
    try:
        if not _check_one_time_token(conn, user_id, claims['iat']):
            return jsonify({'error': 'This cancellation link has already been used', 'code': 'token_used'}), 400

        with conn.cursor() as cur:
            cur.execute("SELECT deleted_at FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Account not found'}), 404
        deleted_at = row[0]
        if deleted_at is None:
            _mark_token_used(conn, user_id)
            return jsonify({'status': 'ok', 'message': 'Account is already active'}), 200

        _mark_token_used(conn, user_id)
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET deleted_at = NULL WHERE id = %s", (user_id,))
        conn.commit()
        return jsonify({'status': 'ok', 'message': 'Account deletion cancelled. Your account is fully restored.'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'cancel_deletion failed for user {user_id}: {e}')
        return jsonify({'error': 'Failed to cancel deletion'}), 500
    finally:
        release_connection(conn)


@app.route('/auth/login', methods=['POST'])
@limiter.limit(RL_AUTH_LOGIN)
def login():
    data = request.get_json()

    identifier = (data or {}).get('email') or (data or {}).get('username')
    password = (data or {}).get('password')
    if not identifier or not password:
        return jsonify({'error': 'Email/username and password required'}), 400

    # L3: honeypot
    data_raw = request.get_json() or {}
    if data_raw.get('website'):
        bcrypt.checkpw(b'dummy', bcrypt.hashpw(b'dummy', bcrypt.gensalt()))
        return jsonify({'error': 'Invalid credentials'}), 401

    # L4: timing check
    try:
        elapsed_ms = int(data_raw.get('_elapsed_ms', 9999))
        if elapsed_ms < 200:
            bcrypt.checkpw(b'dummy', bcrypt.hashpw(b'dummy', bcrypt.gensalt()))
            return jsonify({'error': 'Invalid credentials'}), 401
    except (ValueError, TypeError):
        pass

    conn = get_connection()
    try:
        # Route by presence of @ — usernames cannot contain @
        if '@' in identifier:
            row = get_user_by_email(conn, identifier)
        else:
            row = get_user_by_username(conn, identifier)

        if not row:
            # Dummy check to prevent timing attacks revealing whether
            # the account exists
            bcrypt.checkpw(b'dummy', bcrypt.hashpw(b'dummy', bcrypt.gensalt()))
            return jsonify({'error': 'Invalid credentials'}), 401

        user_id, stored_hash = row

        # Soft-delete check — account scheduled for deletion
        with conn.cursor() as cur:
            cur.execute("SELECT deleted_at FROM users WHERE id = %s", (user_id,))
            del_row = cur.fetchone()
        if del_row and del_row[0]:
            return jsonify({'error': 'This account is scheduled for deletion. Check your email for a cancellation link.', 'code': 'account_deleted'}), 403

        # Lockout check — manual lock or timed auto-lock from brute-force
        with conn.cursor() as cur:
            cur.execute(
                "SELECT login_locked, login_locked_until, failed_login_attempts FROM users WHERE id = %s",
                (user_id,)
            )
            lock_row = cur.fetchone()
        if lock_row:
            manual_locked, locked_until, _ = lock_row
            if manual_locked:
                return jsonify({'error': 'Account is locked. Contact an admin to unlock.', 'code': 'account_locked'}), 403
            if locked_until and locked_until > datetime.now(timezone.utc):
                # Sentinel year-9999 date means permanent lock — admin must unlock
                if locked_until.year >= 9999:
                    return jsonify({'error': 'Account is permanently locked due to too many failed attempts. Contact an admin to unlock.', 'code': 'account_locked_permanent'}), 403
                remaining = int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
                return jsonify({'error': f'Too many failed attempts. Try again in {remaining} minute(s).', 'code': 'account_locked_timed'}), 429

        if not stored_hash or not stored_hash.startswith('$2'):
            app.logger.error(f'Invalid password hash for user {user_id} — hash is missing or not bcrypt')
            return jsonify({'error': 'Invalid credentials'}), 401

        if not bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
            # Increment failed attempts; auto-lock if threshold hit
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE users SET
                         failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
                         login_locked_until = CASE
                             WHEN COALESCE(failed_login_attempts, 0) + 1 >= %s
                             THEN %s::timestamptz
                             WHEN COALESCE(failed_login_attempts, 0) + 1 >= %s
                             THEN now() + interval '60 minutes'
                             WHEN COALESCE(failed_login_attempts, 0) + 1 >= %s
                             THEN now() + interval '15 minutes'
                             ELSE login_locked_until
                         END
                       WHERE id = %s""",
                    (_LOGIN_TIER3_ATTEMPTS, _LOGIN_PERMANENT_SENTINEL,
                     _LOGIN_TIER2_ATTEMPTS, _LOGIN_TIER1_ATTEMPTS, user_id)
                )
            conn.commit()
            return jsonify({'error': 'Invalid credentials'}), 401

        # Identity is the integer user id (as a string, since JWT subjects
        # must be strings) - NOT the username. Every downstream DB query
        # keyed on user_id depends on this being the real foreign key value.
        #
        # fresh=True: this token was obtained via an actual password
        # check, this instant - it satisfies @jwt_required(fresh=True)
        # routes (impersonate, delete-user, edit-credentials). A token
        # later obtained via /auth/refresh is deliberately NOT fresh -
        # see refresh() below.
        access_token = create_access_token(identity=str(user_id), fresh=True)
        refresh_token = create_refresh_token(identity=str(user_id))
        access_jti = decode_token(access_token)['jti']
        resp = jsonify({
            'access_token': access_token,
            'refresh_token': refresh_token,
            'csrf_access_token': get_csrf_token(access_token),
            'csrf_refresh_token': get_csrf_token(refresh_token),
            'hmac_signing_secret': derive_signing_secret(str(user_id), access_jti),
        })
        set_access_cookies(resp, access_token)
        set_refresh_cookies(resp, refresh_token)
        # Successful login: reset brute-force counters + mark session start
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET session_started_at = now(), failed_login_attempts = 0, login_locked_until = NULL WHERE id = %s",
                (user_id,),
            )
        conn.commit()
        return resp, 200
    finally:
        release_connection(conn)


def validate_username(username):
    """Returns an error message string, or None if valid. Shared by
    /auth/signup and PATCH /admin/users/<id>/credentials so both
    paths - self-signup and an admin editing someone else's account -
    enforce identical rules and can never quietly drift apart."""
    if not username:
        return 'Username cannot be empty'
    if len(username) < 3:
        return 'Username must be at least 3 characters'
    if len(username) > 30:
        return 'Username must be under 30 characters'
    if not username.replace('_', '').replace('-', '').isalnum():
        return 'Username can only contain letters, numbers, hyphens and underscores'
    return None


def validate_password(password):
    """Returns an error message string, or None if valid. Same sharing
    reasoning as validate_username above."""
    if not password or len(password) < 8:
        return 'Password must be at least 8 characters'
    return None


@app.route('/auth/signup', methods=['POST'])
@limiter.limit(RL_AUTH_SIGNUP)
def signup():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'username and password required'}), 400

    username = data['username'].strip()
    password = data['password']
    email = data.get('email', '').strip() or None

    error = validate_username(username) or validate_password(password)
    if error:
        return jsonify({'error': error}), 400
    if email:
        error = validate_email(email)
        if error:
            return jsonify({'error': error}), 400

    conn = get_connection()
    try:
        if username_exists(conn, username):
            return jsonify({'error': 'Username already taken'}), 409
        if email and email_exists(conn, email):
            return jsonify({'error': 'An account with that email already exists'}), 409

        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12))
        new_id = create_user(conn, username, hashed.decode('utf-8'), email=email)

        # fresh=True: they just set this password, this instant - same
        # reasoning as login()'s fresh=True above.
        access_token = create_access_token(identity=str(new_id), fresh=True)
        refresh_token = create_refresh_token(identity=str(new_id))
        access_jti = decode_token(access_token)['jti']
        resp = jsonify({
            'access_token': access_token,
            'refresh_token': refresh_token,
            'csrf_access_token': get_csrf_token(access_token),
            'csrf_refresh_token': get_csrf_token(refresh_token),
            'hmac_signing_secret': derive_signing_secret(str(new_id), access_jti),
        })
        set_access_cookies(resp, access_token)
        set_refresh_cookies(resp, refresh_token)
        return resp, 201
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Signup failed: {e}')
        return jsonify({'error': 'Signup failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/auth/refresh', methods=['POST'])
@jwt_required(refresh=True)
@limiter.limit(RL_AUTH_REFRESH)
def refresh():
    """Exchanges a valid REFRESH token for a brand new, short-lived
    ACCESS token - lets the app stay "logged in" across the access
    token's 24h expiry without asking for a password again, right up
    until the refresh token itself (30 days) also expires or is
    revoked. @jwt_required(refresh=True) means this route only accepts
    a refresh token in the Authorization header, not an access token -
    the two are deliberately not interchangeable.

    The new access token is marked fresh=False - it was obtained via a
    refresh, not an actual password entry a moment ago, so it does NOT
    satisfy @jwt_required(fresh=True) routes (impersonate, delete-user,
    edit-credentials). Those specifically require logging in for real,
    on purpose - see admin_impersonate_user()'s docstring.
    """
    current_user = get_jwt_identity()
    new_access_token = create_access_token(identity=current_user, fresh=False)
    new_jti = decode_token(new_access_token)['jti']
    resp = jsonify({
        'access_token': new_access_token,
        'csrf_access_token': get_csrf_token(new_access_token),
        'hmac_signing_secret': derive_signing_secret(str(current_user), new_jti),
    })
    set_access_cookies(resp, new_access_token)
    return resp, 200


@app.route('/auth/logout', methods=['POST'])
@jwt_required()
@limiter.limit(RL_ADMIN_SENSITIVE)
def logout_route():
    """Actually revokes the calling token server-side - the first time
    "logout" has ever meant anything beyond a device deleting its own
    local copy (see api.js's old logout(), and handoff5.txt for why
    that was never enough on its own). Revokes the ACCESS token this
    very request was authenticated with (its jti/exp are already
    available via get_jwt()) automatically. If a refresh_token is also
    included in the request body, that gets revoked too in the same
    call - decoded and verified via decode_token() (a plain signature
    check, same as any other token verification) rather than trusted
    blindly, so a garbage/malformed value in that field just gets
    silently ignored rather than erroring the whole logout.
    """
    current_user = int(get_jwt_identity())
    claims = get_jwt()
    jti = claims["jti"]
    exp_ts = claims["exp"]

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO revoked_tokens (jti, expires_at) VALUES (%s, to_timestamp(%s)) ON CONFLICT (jti) DO NOTHING",
                (jti, exp_ts),
            )

        data = request.get_json(silent=True) or {}
        refresh_token_str = data.get('refresh_token')
        if refresh_token_str:
            try:
                decoded = decode_token(refresh_token_str)
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO revoked_tokens (jti, expires_at) VALUES (%s, to_timestamp(%s)) ON CONFLICT (jti) DO NOTHING",
                        (decoded["jti"], decoded["exp"]),
                    )
            except Exception:
                # Not a valid token at all (garbage string, wrong
                # secret, already expired past decode tolerance) -
                # nothing meaningful to revoke, and the ACCESS token
                # revocation above already succeeded regardless, so
                # this is not treated as a hard failure of the whole
                # request.
                pass
            
        # Marks a fresh "session boundary" the same way login() does -
        # any file uploaded before THIS moment now correctly reads as
        # "past" the next time /uploads/breakdown is called, even
        # though the person hasn't logged back in yet.
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET session_started_at = now() WHERE id = %s",
                (current_user,),
            )

        conn.commit()
        resp = jsonify({'status': 'ok'})
        unset_jwt_cookies(resp)
        return resp, 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Logout failed: {e}')
        return jsonify({'error': 'Logout failed'}), 500
    finally:
        release_connection(conn)
