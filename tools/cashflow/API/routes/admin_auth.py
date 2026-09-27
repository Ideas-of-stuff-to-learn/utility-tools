"""
routes/admin_auth.py

Admin-panel authentication: credential isolation (admin_users table,
completely separate from the main users table), session isolation
(admin_access_token / admin_refresh_token cookies — never set by the
regular /auth/login endpoint), and TOTP MFA on every login.

Endpoints:
  POST /admin/auth/login         — password check → issue temp token
  POST /admin/auth/verify-totp   — TOTP check → issue session cookies
  POST /admin/auth/refresh       — refresh admin session
  POST /admin/auth/logout        — clear admin cookies only
  GET  /admin/auth/me            — return caller identity from admin token

CLI:
  flask create-admin             — bootstrap the first owner-level account
"""
import os
import secrets
from datetime import datetime, timezone, timedelta

import bcrypt
import pyotp

from flask import request, jsonify, make_response, g
from flask_jwt_extended import (
    create_access_token, create_refresh_token, decode_token, get_csrf_token
)

from extensions import app, limiter
from middleware.admin_rate_limits import (
    RL_ADMIN_LOGIN, RL_ADMIN_ME, RL_ADMIN_REFRESH,
    RL_READ_ADMIN, RL_ADMIN_WRITE, RL_ADMIN_SENSITIVE,
    RL_GEO_HEARTBEAT,
)
from database import get_connection, release_connection
from middleware.admin_middleware import get_admin_role_and_permissions, require_admin_auth
from hmac_auth import derive_signing_secret

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from backendLocalConfig import ADMIN_ACCOUNT_MIN_LEVEL
from audit import write_audit as _write_audit

_ADMIN_TEMP_EXPIRES    = timedelta(minutes=5)
_ADMIN_ACCESS_EXPIRES  = timedelta(hours=2)
_ADMIN_REFRESH_EXPIRES = timedelta(hours=24)
_ADMIN_MAX_FAILED      = 5
_ADMIN_LOCKOUT_MINUTES = 30
_ADMIN_PERM_SENTINEL   = '9999-01-01 00:00:00+00'

IS_LOCAL_DEV = os.environ.get('LOCAL_DEV', 'false').lower() in ('true', '1')


# ── Cookie helpers ────────────────────────────────────────────────────────────

def _set_admin_cookies(resp, access_token, refresh_token):
    secure = not IS_LOCAL_DEV
    samesite = 'Lax' if IS_LOCAL_DEV else 'None'
    resp.set_cookie('admin_access_token',  access_token,  httponly=True,
                    secure=secure, samesite=samesite, path='/',
                    max_age=int(_ADMIN_ACCESS_EXPIRES.total_seconds()))
    resp.set_cookie('admin_refresh_token', refresh_token, httponly=True,
                    secure=secure, samesite=samesite, path='/',
                    max_age=int(_ADMIN_REFRESH_EXPIRES.total_seconds()))
    # JS-readable CSRF doubles
    csrf_access  = get_csrf_token(access_token)
    csrf_refresh = get_csrf_token(refresh_token)
    resp.set_cookie('admin_csrf_access',   csrf_access,  httponly=False,
                    secure=secure, samesite=samesite, path='/')
    resp.set_cookie('admin_csrf_refresh',  csrf_refresh, httponly=False,
                    secure=secure, samesite=samesite, path='/')
    return csrf_access, csrf_refresh


def _unset_admin_cookies(resp):
    for name in ('admin_access_token', 'admin_refresh_token',
                 'admin_csrf_access', 'admin_csrf_refresh'):
        resp.delete_cookie(name, path='/')


def _issue_admin_session(admin_user_id):
    """Create access + refresh tokens with admin_session=True claim."""
    claims = {'admin_session': True}
    access_token  = create_access_token(
        identity=str(admin_user_id),
        additional_claims=claims,
        expires_delta=_ADMIN_ACCESS_EXPIRES,
        fresh=True,
    )
    refresh_token = create_refresh_token(
        identity=str(admin_user_id),
        additional_claims=claims,
        expires_delta=_ADMIN_REFRESH_EXPIRES,
    )
    return access_token, refresh_token


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_admin_by_username(conn, username):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, password_hash, totp_enrolled, login_locked, failed_attempts, locked_until FROM admin_users WHERE username = %s",
            (username,),
        )
        return cur.fetchone()


def _write_login_log(conn, admin_user_id, outcome):
    ip = request.remote_addr or ''
    ua = request.headers.get('User-Agent', '')[:512]
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO admin_login_log (admin_user_id, ip, user_agent, outcome) VALUES (%s, %s, %s, %s)",
            (admin_user_id, ip, ua, outcome),
        )


def _reset_failed(conn, admin_user_id):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = %s",
            (admin_user_id,),
        )


def _increment_failed(conn, admin_user_id):
    with conn.cursor() as cur:
        cur.execute(
            f"""UPDATE admin_users SET
                 failed_attempts = COALESCE(failed_attempts, 0) + 1,
                 locked_until = CASE
                     WHEN COALESCE(failed_attempts, 0) + 1 >= {_ADMIN_MAX_FAILED}
                     THEN '{_ADMIN_PERM_SENTINEL}'::timestamptz
                     ELSE now() + interval '{_ADMIN_LOCKOUT_MINUTES} minutes'
                 END
               WHERE id = %s""",
            (admin_user_id,),
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route('/admin/auth/login', methods=['POST'])
@limiter.limit(RL_ADMIN_LOGIN)
def admin_login():
    """Step 1 of 2-factor admin login: verify username + password.
    Returns a short-lived temp token used for the TOTP step.
    """
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    conn = get_connection()
    try:
        row = _get_admin_by_username(conn, username)
        if not row:
            bcrypt.checkpw(b'dummy', bcrypt.hashpw(b'dummy', bcrypt.gensalt()))
            return jsonify({'error': 'Invalid credentials'}), 401

        admin_id, stored_hash, totp_enrolled, login_locked, failed_attempts, locked_until = row

        if login_locked:
            return jsonify({'error': 'Account locked. Contact the system owner.', 'code': 'locked'}), 403
        if locked_until and locked_until > datetime.now(timezone.utc):
            remaining = int((locked_until - datetime.now(timezone.utc)).total_seconds() / 60) + 1
            return jsonify({'error': f'Too many failed attempts. Try again in {remaining} minute(s).', 'code': 'locked_timed'}), 429

        if not bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
            _increment_failed(conn, admin_id)
            _write_login_log(conn, admin_id, 'fail_password')
            conn.commit()
            return jsonify({'error': 'Invalid credentials'}), 401

        # Password correct — issue short-lived temp token for TOTP step
        totp_secret = None
        if not totp_enrolled:
            # Generate and store secret for first-time enrollment
            totp_secret = pyotp.random_base32()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE admin_users SET totp_secret = %s WHERE id = %s",
                    (totp_secret, admin_id),
                )
            conn.commit()
        else:
            conn.commit()

        temp_token = create_access_token(
            identity=str(admin_id),
            additional_claims={
                'admin_pre_auth': True,
                'totp_enrolling': not totp_enrolled,
            },
            expires_delta=_ADMIN_TEMP_EXPIRES,
            fresh=False,
        )

        response_data = {
            'temp_token': temp_token,
            'step': 'enroll' if not totp_enrolled else 'totp',
        }

        if not totp_enrolled and totp_secret:
            issuer = 'utility-tools-admin'
            totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
                name=username,
                issuer_name=issuer,
            )
            response_data['totp_uri'] = totp_uri

        return jsonify(response_data), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_login failed: {e}')
        return jsonify({'error': 'Login failed'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/auth/verify-totp', methods=['POST'])
@limiter.limit(RL_ADMIN_LOGIN)
def admin_verify_totp():
    """Step 2 of 2-factor admin login: verify TOTP code.
    On success issues admin session cookies.
    """
    data = request.get_json() or {}
    temp_token_str = data.get('temp_token') or ''
    totp_code = (data.get('totp_code') or '').strip()

    if not temp_token_str or not totp_code:
        return jsonify({'error': 'temp_token and totp_code required'}), 400

    try:
        token_data = decode_token(temp_token_str)
    except Exception:
        return jsonify({'error': 'Invalid or expired session. Please log in again.'}), 401

    if not token_data.get('admin_pre_auth'):
        return jsonify({'error': 'Invalid token type'}), 401

    admin_id = int(token_data['sub'])
    enrolling = token_data.get('totp_enrolling', False)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT totp_secret, totp_enrolled FROM admin_users WHERE id = %s",
                (admin_id,),
            )
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Account not found'}), 404

        totp_secret, already_enrolled = row
        if not totp_secret:
            return jsonify({'error': 'TOTP not configured for this account'}), 400

        totp = pyotp.TOTP(totp_secret)
        if not totp.verify(totp_code, valid_window=1):
            _write_login_log(conn, admin_id, 'fail_totp')
            conn.commit()
            return jsonify({'error': 'Invalid authenticator code'}), 401

        # Mark enrolled if this was the enrollment step
        if enrolling:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE admin_users SET totp_enrolled = true WHERE id = %s",
                    (admin_id,),
                )

        _reset_failed(conn, admin_id)
        _write_login_log(conn, admin_id, 'success')

        # Geo-block check — runs BEFORE session is issued so we never
        # hand out tokens we'd immediately revoke.
        from geo import check_geo_at_login
        client_ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()
        geo_allowed, geo_blocked, geo_message, _geo_outcome = check_geo_at_login(admin_id, client_ip, conn)
        conn.commit()

        if not geo_allowed:
            return jsonify({'error': geo_message, 'geo_blocked': True}), 403

        access_token, refresh_token = _issue_admin_session(admin_id)
        access_jti = decode_token(access_token)['jti']
        role_name, level, perms = get_admin_role_and_permissions(conn, admin_id)
        with conn.cursor() as cur:
            cur.execute("SELECT username FROM admin_users WHERE id = %s", (admin_id,))
            username_row = cur.fetchone()

        resp = jsonify({
            'csrf_admin_access':  get_csrf_token(access_token),
            'csrf_admin_refresh': get_csrf_token(refresh_token),
            'hmac_signing_secret': derive_signing_secret(str(admin_id), access_jti),
            'role': role_name,
            'level': level,
            'permissions': sorted(perms),
            'username': username_row[0] if username_row else '',
            'display_name': username_row[0] if username_row else '',
        })
        _set_admin_cookies(resp, access_token, refresh_token)
        return resp, 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_verify_totp failed: {e}')
        return jsonify({'error': 'Verification failed'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/auth/refresh', methods=['POST'])
@limiter.limit(RL_ADMIN_REFRESH)
def admin_refresh():
    """Refresh the admin session using the admin_refresh_token cookie."""
    token_str = request.cookies.get('admin_refresh_token')
    csrf_header = request.headers.get('X-Admin-CSRF-TOKEN', '')
    csrf_cookie = request.cookies.get('admin_csrf_refresh', '')

    if not token_str:
        return jsonify({'error': 'No refresh token'}), 401

    # CSRF check on non-GET
    if not IS_LOCAL_DEV and csrf_header != csrf_cookie:
        return jsonify({'error': 'CSRF validation failed'}), 401

    try:
        token_data = decode_token(token_str)
    except Exception:
        return jsonify({'error': 'Refresh token invalid or expired'}), 401

    if not token_data.get('admin_session'):
        return jsonify({'error': 'Not an admin refresh token'}), 401

    admin_id = int(token_data['sub'])
    access_token, refresh_token = _issue_admin_session(admin_id)
    access_jti = decode_token(access_token)['jti']

    conn = get_connection()
    try:
        role_name, level, perms = get_admin_role_and_permissions(conn, admin_id)
    finally:
        release_connection(conn)

    resp = jsonify({
        'csrf_admin_access':  get_csrf_token(access_token),
        'csrf_admin_refresh': get_csrf_token(refresh_token),
        'hmac_signing_secret': derive_signing_secret(str(admin_id), access_jti),
    })
    _set_admin_cookies(resp, access_token, refresh_token)
    return resp, 200


@app.route('/admin/auth/logout', methods=['POST'])
def admin_logout():
    """Clear admin session cookies only. Does not touch regular user session."""
    jti = None
    token_str = request.cookies.get('admin_access_token')
    if token_str:
        try:
            jti = decode_token(token_str).get('jti')
        except Exception:
            pass

    if jti:
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO revoked_tokens (jti) VALUES (%s) ON CONFLICT DO NOTHING",
                    (jti,),
                )
            conn.commit()
        except Exception:
            pass
        finally:
            release_connection(conn)

    resp = jsonify({'status': 'ok'})
    _unset_admin_cookies(resp)
    return resp, 200


@app.route('/admin/auth/me', methods=['GET'])
@require_admin_auth()
@limiter.limit(RL_ADMIN_ME)
def admin_me():
    """Return the current admin user's identity + CSRF refresh token.
    Used on every admin panel load to check session validity.
    """
    admin_id = g.admin_user_id
    conn = get_connection()
    try:
        role_name, level, perms = get_admin_role_and_permissions(conn, admin_id)
        with conn.cursor() as cur:
            cur.execute("SELECT username FROM admin_users WHERE id = %s", (admin_id,))
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Admin account not found'}), 404

        # Refresh CSRF tokens in the response so the client stays in sync
        access_token_str  = request.cookies.get('admin_access_token', '')
        refresh_token_str = request.cookies.get('admin_refresh_token', '')
        csrf_access  = get_csrf_token(access_token_str)  if access_token_str  else ''
        csrf_refresh = get_csrf_token(refresh_token_str) if refresh_token_str else ''

        return jsonify({
            'id':                 admin_id,
            'username':           row[0],
            'display_name':       row[0],
            'role':               role_name,
            'level':              level,
            'permissions':        sorted(perms),
            'csrf_admin_access':  csrf_access,
            'csrf_admin_refresh': csrf_refresh,
        }), 200
    except Exception as e:
        app.logger.error(f'admin_me failed: {e}')
        return jsonify({'error': 'Failed to fetch identity'}), 500
    finally:
        release_connection(conn)


# ── Admin-accounts management endpoints ───────────────────────────────────────

@app.route('/admin/accounts', methods=['GET'])
@require_admin_auth('admin.accounts.manage')
@limiter.limit(RL_READ_ADMIN)
def admin_list_accounts():
    """List all admin_users accounts (owner-facing view)."""
    caller_id = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _ = get_admin_role_and_permissions(conn, caller_id)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT au.id, au.username, r.name, r.level,
                          au.totp_enrolled, au.login_locked, au.created_at, au.last_login_at
                   FROM admin_users au LEFT JOIN roles r ON au.role_id = r.id
                   ORDER BY r.level DESC NULLS LAST, au.username""",
            )
            rows = cur.fetchall()
        accounts = []
        for aid, uname, rname, rlevel, enrolled, locked, created, last_login in rows:
            if caller_role != 'owner' and (rlevel or 0) >= caller_level:
                continue
            accounts.append({
                'id':           aid,
                'username':     uname,
                'role':         rname or '',
                'level':        rlevel or 0,
                'totp_enrolled': bool(enrolled),
                'login_locked': bool(locked),
                'created_at':   created.isoformat() if created else None,
                'last_login_at': last_login.isoformat() if last_login else None,
            })
        return jsonify({'accounts': accounts}), 200
    except Exception as e:
        app.logger.error(f'admin_list_accounts failed: {e}')
        return jsonify({'error': 'Failed to fetch accounts'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/accounts', methods=['POST'])
@require_admin_auth('admin.accounts.manage')
@limiter.limit(RL_ADMIN_WRITE)
def admin_create_account():
    """Create a new admin_users account with an assigned role."""
    caller_id = g.admin_user_id
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    role_name = (data.get('role') or '').strip()

    if not username or not password or not role_name:
        return jsonify({'error': 'username, password, and role are required'}), 400

    if len(username) < 3 or len(username) > 32:
        return jsonify({'error': 'Username must be 3–32 characters'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    conn = get_connection()
    try:
        caller_role, caller_level, _ = get_admin_role_and_permissions(conn, caller_id)

        with conn.cursor() as cur:
            cur.execute("SELECT id, level FROM roles WHERE name = %s", (role_name,))
            role_row = cur.fetchone()
        if not role_row:
            return jsonify({'error': f'Role "{role_name}" not found'}), 404
        role_id, role_level = role_row

        if role_level < ADMIN_ACCOUNT_MIN_LEVEL:
            return jsonify({'error': f'Role level {role_level} is below the minimum allowed for admin accounts ({ADMIN_ACCOUNT_MIN_LEVEL})'}), 403

        if caller_role != 'owner' and role_level >= caller_level:
            return jsonify({'error': f'Cannot create an account with a role at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM admin_users WHERE username = %s", (username,))
            if cur.fetchone():
                return jsonify({'error': 'Username already taken'}), 409

        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO admin_users (username, password_hash, role_id, created_by) VALUES (%s, %s, %s, %s) RETURNING id",
                (username, hashed, role_id, caller_id),
            )
            new_id = cur.fetchone()[0]
        _write_audit(conn, caller_id, 'admin.account.create', 'admin_user', new_id, {'username': username, 'role': role_name})
        conn.commit()
        return jsonify({'account': {'id': new_id, 'username': username, 'role': role_name, 'level': role_level}}), 201
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_create_account failed: {e}')
        return jsonify({'error': 'Account creation failed'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/accounts/<int:target_id>', methods=['DELETE'])
@require_admin_auth('admin.accounts.manage')
@limiter.limit(RL_ADMIN_WRITE)
def admin_delete_account(target_id):
    """Deactivate (hard-delete) an admin account. Cannot delete your own."""
    caller_id = g.admin_user_id
    if target_id == caller_id:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    conn = get_connection()
    try:
        caller_role, caller_level, _ = get_admin_role_and_permissions(conn, caller_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT au.username, r.level FROM admin_users au LEFT JOIN roles r ON au.role_id = r.id WHERE au.id = %s",
                (target_id,),
            )
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Account not found'}), 404
        username, target_level = row
        if caller_role != 'owner' and (target_level or 0) >= caller_level:
            return jsonify({'error': f'Cannot delete an account at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            cur.execute("DELETE FROM admin_users WHERE id = %s", (target_id,))
        _write_audit(conn, caller_id, 'admin.account.delete', 'admin_user', target_id, {'username': username})
        conn.commit()
        return jsonify({'status': 'ok', 'deleted_username': username}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_delete_account failed: {e}')
        return jsonify({'error': 'Delete failed'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/accounts/<int:target_id>', methods=['PATCH'])
@require_admin_auth('admin.accounts.manage')
@limiter.limit(RL_ADMIN_WRITE)
def admin_edit_account(target_id):
    """Change the role of an admin account. Cannot edit your own or accounts at/above your level."""
    caller_id = g.admin_user_id
    if target_id == caller_id:
        return jsonify({'error': 'Cannot edit your own account'}), 400

    data = request.get_json() or {}
    role_name = (data.get('role') or '').strip()
    if not role_name:
        return jsonify({'error': 'role is required'}), 400

    conn = get_connection()
    try:
        caller_role, caller_level, _ = get_admin_role_and_permissions(conn, caller_id)

        with conn.cursor() as cur:
            cur.execute(
                "SELECT au.username, r.level FROM admin_users au LEFT JOIN roles r ON au.role_id = r.id WHERE au.id = %s",
                (target_id,),
            )
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Account not found'}), 404
        username, target_level = row
        if caller_role != 'owner' and (target_level or 0) >= caller_level:
            return jsonify({'error': f'Cannot edit an account at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            cur.execute("SELECT id, level FROM roles WHERE name = %s", (role_name,))
            role_row = cur.fetchone()
        if not role_row:
            return jsonify({'error': f'Role "{role_name}" not found'}), 404
        role_id, role_level = role_row

        if role_level < ADMIN_ACCOUNT_MIN_LEVEL:
            return jsonify({'error': f'Role level {role_level} is below the minimum allowed ({ADMIN_ACCOUNT_MIN_LEVEL})'}), 403
        if caller_role != 'owner' and role_level >= caller_level:
            return jsonify({'error': f'Cannot assign a role at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            cur.execute("UPDATE admin_users SET role_id = %s WHERE id = %s", (role_id, target_id))
        _write_audit(conn, caller_id, 'admin.account.edit_role', 'admin_user', target_id,
                     {'username': username, 'new_role': role_name, 'new_level': role_level})
        conn.commit()
        return jsonify({'account': {'id': target_id, 'username': username, 'role': role_name, 'level': role_level}}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_edit_account failed: {e}')
        return jsonify({'error': 'Edit failed'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/accounts/<int:target_id>/reset-mfa', methods=['POST'])
@require_admin_auth('admin.accounts.manage')
@limiter.limit(RL_ADMIN_SENSITIVE)
def admin_reset_mfa(target_id):
    """Clear TOTP secret and enrolled flag — forces re-enrolment on next login."""
    caller_id = g.admin_user_id
    if target_id == caller_id:
        return jsonify({'error': 'Cannot reset your own MFA from here'}), 400

    conn = get_connection()
    try:
        caller_role, caller_level, _ = get_admin_role_and_permissions(conn, caller_id)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT au.username, r.level FROM admin_users au LEFT JOIN roles r ON au.role_id = r.id WHERE au.id = %s",
                (target_id,),
            )
            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Account not found'}), 404
        username, target_level = row
        if caller_role != 'owner' and (target_level or 0) >= caller_level:
            return jsonify({'error': f'Cannot reset MFA for an account at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE admin_users SET totp_secret = NULL, totp_enrolled = false WHERE id = %s",
                (target_id,),
            )
        _write_audit(conn, caller_id, 'admin.account.reset_mfa', 'admin_user', target_id, {'username': username})
        conn.commit()
        return jsonify({'status': 'ok', 'username': username}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_reset_mfa failed: {e}')
        return jsonify({'error': 'MFA reset failed'}), 500
    finally:
        release_connection(conn)


# ── Geo heartbeat ─────────────────────────────────────────────────────────────

@app.route('/admin/geo/heartbeat', methods=['POST'])
@require_admin_auth()
@limiter.limit(RL_GEO_HEARTBEAT)
def admin_geo_heartbeat():
    """Periodic geo check called by the admin panel every 10 minutes.

    If impossible travel is detected the session is revoked server-side and
    a 403 is returned. The frontend shows the in-app alert and logs out.
    """
    admin_id = g.admin_user_id
    jti      = g.admin_token_jti
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip()

    from geo import check_geo_heartbeat
    conn = get_connection()
    try:
        allowed, message, outcome = check_geo_heartbeat(admin_id, client_ip, jti, conn, trigger='heartbeat')
        conn.commit()
    except Exception as e:
        conn.rollback()
        app.logger.error('geo_heartbeat failed: %s', e)
        return jsonify({'status': 'ok', 'outcome': 'error'}), 200  # fail-open
    finally:
        release_connection(conn)

    if not allowed:
        return jsonify({'geo_blocked': True, 'message': message}), 403

    return jsonify({'status': 'ok', 'outcome': outcome}), 200


# ── Flask CLI bootstrap ───────────────────────────────────────────────────────

import click

@app.cli.command('create-admin')
@click.option('--username', prompt=True, help='Admin username')
@click.password_option('--password', help='Admin password')
def create_admin(username, password):
    """Bootstrap the first owner-level admin account.
    Run once on initial deploy: flask create-admin
    """
    username = username.strip()
    if len(username) < 3:
        raise click.ClickException('Username must be at least 3 characters')
    if len(password) < 8:
        raise click.ClickException('Password must be at least 8 characters')

    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM admin_users WHERE username = %s", (username,))
            if cur.fetchone():
                raise click.ClickException(f'Admin account "{username}" already exists')
            cur.execute("SELECT id FROM roles WHERE name = 'owner'", )
            owner_role = cur.fetchone()
            if not owner_role:
                raise click.ClickException('Owner role not found in roles table — run schema.sql first')
            cur.execute(
                "INSERT INTO admin_users (username, password_hash, role_id) VALUES (%s, %s, %s) RETURNING id",
                (username, hashed, owner_role[0]),
            )
            new_id = cur.fetchone()[0]
        conn.commit()
        click.echo(f'Admin account created: {username} (id={new_id}, role=owner)')
        click.echo('TOTP enrollment will happen on first login.')
    except click.ClickException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise click.ClickException(f'Failed: {e}')
    finally:
        release_connection(conn)
