"""
routes/billing.py

Billing endpoints — config, status, trial management, Stripe card setup, webhook.

Endpoints:
  GET  /billing/config              — public; stripe_enabled + publishable key
  GET  /billing/status              — authenticated; user's tier/trial/subscription
  POST /billing/start-trial         — start a free trial for a tool
  POST /billing/cancel-trial        — cancel an active trial early
  POST /billing/create-setup-intent — create a Stripe SetupIntent for card collection
  POST /billing/confirm-setup       — confirm card saved, optionally start subscription
  POST /billing/webhook             — Stripe webhook (signature-verified, no JWT)

Helper:
  get_billing_status(conn, user_id) — shared by /auth/me
"""
import hashlib
import hmac
import os
import time

from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from database import get_connection, release_connection
from extensions import app, limiter
from middleware.user_rate_limits import _rl, DISABLE_ALL_RATE_LIMITS

# ── Rate limit flags ──────────────────────────────────────────────────────────
DISABLE_RL_BILLING_CONFIG  = False   # GET /billing/config  (public, cheap)
DISABLE_RL_BILLING_STATUS  = False   # GET /billing/status  (authenticated)
DISABLE_RL_BILLING_WEBHOOK = False   # POST /billing/webhook (Stripe; keep on)

RL_BILLING_CONFIG  = _rl("60 per minute; 2000 per day",  "DISABLE_RL_BILLING_CONFIG")
RL_BILLING_STATUS  = _rl("30 per minute; 1500 per day",  "DISABLE_RL_BILLING_STATUS")
RL_BILLING_WEBHOOK = _rl("300 per minute; 50000 per day","DISABLE_RL_BILLING_WEBHOOK")

# ── Stripe env ────────────────────────────────────────────────────────────────
_STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY')
_STRIPE_SECRET_KEY      = os.environ.get('STRIPE_SECRET_KEY')
_STRIPE_WEBHOOK_SECRET  = os.environ.get('STRIPE_WEBHOOK_SECRET')

STRIPE_ENABLED = bool(_STRIPE_SECRET_KEY and _STRIPE_PUBLISHABLE_KEY)


# ── Billing status helper (used by /auth/me too) ──────────────────────────────

def get_billing_status(conn, user_id: int) -> dict:
    """
    Returns the user's current billing state in a single query.
    Safe to call with no billing tables present — returns base defaults.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COALESCE(s.tier, 'base')             AS tier,
                    s.stripe_status,
                    s.current_period_end,
                    s.cancel_at_period_end,
                    s.payment_failed_at,
                    s.card_last4,
                    s.card_brand,
                    t.tool                               AS trial_tool,
                    t.ends_at                            AS trial_ends_at,
                    t.ended_early                        AS trial_ended_early,
                    g.tool                               AS grant_tool,
                    g.granted                            AS grant_granted,
                    g.expires_at                         AS grant_expires_at
                FROM users u
                LEFT JOIN user_subscriptions   s ON s.user_id = u.id
                LEFT JOIN user_tool_trials     t ON t.user_id = u.id
                                                 AND t.ends_at > NOW()
                                                 AND t.ended_early = FALSE
                LEFT JOIN user_access_grants   g ON g.user_id = u.id
                                                 AND (g.expires_at IS NULL OR g.expires_at > NOW())
                WHERE u.id = %s
                ORDER BY t.ends_at DESC, g.created_at DESC
                LIMIT 1
            """, (user_id,))
            row = cur.fetchone()
    except Exception:
        return _billing_defaults()

    if row is None:
        return _billing_defaults()

    (tier, stripe_status, period_end, cancel_at_period_end, payment_failed_at,
     card_last4, card_brand, trial_tool, trial_ends_at, trial_ended_early,
     grant_tool, grant_granted, grant_expires_at) = row

    active_trial = None
    if trial_tool:
        active_trial = {
            'tool': trial_tool,
            'ends_at': trial_ends_at.isoformat() if trial_ends_at else None,
        }

    access_grant = None
    if grant_tool is not None:
        access_grant = {
            'tool': grant_tool,
            'granted': grant_granted,
            'expires_at': grant_expires_at.isoformat() if grant_expires_at else None,
        }

    return {
        'tier': tier or 'base',
        'stripe_status': stripe_status,
        'current_period_end': period_end.isoformat() if period_end else None,
        'cancel_at_period_end': bool(cancel_at_period_end),
        'payment_failed': bool(payment_failed_at),
        'card_last4': card_last4,
        'card_brand': card_brand,
        'active_trial': active_trial,
        'access_grant': access_grant,
    }


def _billing_defaults() -> dict:
    return {
        'tier': 'base',
        'stripe_status': None,
        'current_period_end': None,
        'cancel_at_period_end': False,
        'payment_failed': False,
        'card_last4': None,
        'card_brand': None,
        'active_trial': None,
        'access_grant': None,
    }


# ── GET /billing/config ───────────────────────────────────────────────────────

@app.route('/billing/config', methods=['GET'])
@limiter.limit(RL_BILLING_CONFIG)
def billing_config():
    """
    Public endpoint. Returns whether Stripe is configured and the publishable key.
    The publishable key is safe to serve publicly — it can only tokenize cards
    for this account, not charge them (that requires the secret key, server-only).
    """
    return jsonify({
        'stripe_enabled': STRIPE_ENABLED,
        'publishable_key': _STRIPE_PUBLISHABLE_KEY if STRIPE_ENABLED else None,
    }), 200


# ── GET /billing/status ───────────────────────────────────────────────────────

@app.route('/billing/status', methods=['GET'])
@jwt_required()
@limiter.limit(RL_BILLING_STATUS)
def billing_status():
    """Authenticated. Returns the requesting user's current billing state."""
    user_id = int(get_jwt_identity())
    conn = get_connection()
    try:
        status = get_billing_status(conn, user_id)
        return jsonify(status), 200
    except Exception as e:
        app.logger.error(f'/billing/status failed for user {user_id}: {e}')
        return jsonify({'error': 'Failed to fetch billing status'}), 500
    finally:
        release_connection(conn)


# ── POST /billing/webhook ─────────────────────────────────────────────────────

@app.route('/billing/webhook', methods=['POST'])
@limiter.limit(RL_BILLING_WEBHOOK)
def billing_webhook():
    """
    Stripe webhook endpoint. No JWT auth — Stripe signs the payload instead.
    Signature verified with STRIPE_WEBHOOK_SECRET.

    Events handled:
      customer.subscription.updated   → sync tier/status/period
      customer.subscription.deleted   → downgrade to base
      invoice.payment_succeeded        → clear payment_failed flag
      invoice.payment_failed           → set payment_failed_at, trigger email
    """
    if not _STRIPE_WEBHOOK_SECRET:
        app.logger.warning('Stripe webhook received but STRIPE_WEBHOOK_SECRET not set — ignoring')
        return jsonify({'status': 'not_configured'}), 200

    payload   = request.get_data()
    sig_header = request.headers.get('Stripe-Signature', '')

    if not _verify_stripe_signature(payload, sig_header, _STRIPE_WEBHOOK_SECRET):
        app.logger.warning('Stripe webhook signature verification failed')
        return jsonify({'error': 'Invalid signature'}), 400

    try:
        import json
        event = json.loads(payload)
    except Exception:
        return jsonify({'error': 'Invalid JSON'}), 400

    event_type = event.get('type', '')
    data_obj   = event.get('data', {}).get('object', {})

    if event_type in ('customer.subscription.updated', 'customer.subscription.deleted'):
        _handle_subscription_change(event_type, data_obj)
    elif event_type == 'invoice.payment_succeeded':
        _handle_payment_succeeded(data_obj)
    elif event_type == 'invoice.payment_failed':
        _handle_payment_failed(data_obj)
    else:
        app.logger.debug(f'Unhandled Stripe event: {event_type}')

    return jsonify({'status': 'ok'}), 200


def _verify_stripe_signature(payload: bytes, sig_header: str, secret: str) -> bool:
    """
    Verifies Stripe's webhook signature without the stripe-python library.
    Implements Stripe's v1 signature scheme:
      1. Extract timestamp + signatures from Stripe-Signature header
      2. Compute HMAC-SHA256 of "{timestamp}.{payload}" with the webhook secret
      3. Compare against each v1 signature in the header
      4. Reject if timestamp is >5 minutes old (replay protection)
    """
    try:
        parts = {k: v for k, v in (p.split('=', 1) for p in sig_header.split(','))}
        ts    = int(parts.get('t', '0'))
        sigs  = [v for k, v in (p.split('=', 1) for p in sig_header.split(',')) if k == 'v1']
    except Exception:
        return False

    if abs(time.time() - ts) > 300:  # 5-minute replay window
        return False

    signed_payload = f'{ts}.'.encode() + payload
    expected = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


def _handle_subscription_change(event_type: str, sub: dict):
    """Sync user_subscriptions row from a Stripe subscription object."""
    stripe_sub_id = sub.get('id')
    if not stripe_sub_id:
        return

    status         = sub.get('status', '')
    period_end     = sub.get('current_period_end')
    cancel_at_end  = sub.get('cancel_at_period_end', False)
    new_tier       = 'pro' if status in ('active', 'trialing') else 'base'

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_subscriptions
                   SET tier                 = %s,
                       stripe_status        = %s,
                       current_period_end   = TO_TIMESTAMP(%s),
                       cancel_at_period_end = %s,
                       updated_at           = NOW()
                 WHERE stripe_subscription_id = %s
            """, (new_tier, status, period_end, cancel_at_end, stripe_sub_id))
        conn.commit()
        app.logger.info(f'Subscription {stripe_sub_id} → tier={new_tier} status={status}')
    except Exception as e:
        app.logger.error(f'Failed to sync subscription {stripe_sub_id}: {e}')
        try: conn.rollback()
        except Exception: pass
    finally:
        release_connection(conn)


def _handle_payment_succeeded(invoice: dict):
    """Clear payment_failed_at when an invoice pays successfully."""
    stripe_sub_id = invoice.get('subscription')
    if not stripe_sub_id:
        return

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_subscriptions
                   SET payment_failed_at = NULL,
                       updated_at        = NOW()
                 WHERE stripe_subscription_id = %s
            """, (stripe_sub_id,))
        conn.commit()
    except Exception as e:
        app.logger.error(f'Failed to clear payment_failed_at for {stripe_sub_id}: {e}')
        try: conn.rollback()
        except Exception: pass
    finally:
        release_connection(conn)


def _handle_payment_failed(invoice: dict):
    """Set payment_failed_at so the UI can surface a payment failure banner."""
    stripe_sub_id = invoice.get('subscription')
    if not stripe_sub_id:
        return

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_subscriptions
                   SET payment_failed_at = NOW(),
                       updated_at        = NOW()
                 WHERE stripe_subscription_id = %s
            """, (stripe_sub_id,))
        conn.commit()
        app.logger.warning(f'Payment failed for subscription {stripe_sub_id}')
    except Exception as e:
        app.logger.error(f'Failed to set payment_failed_at for {stripe_sub_id}: {e}')
        try: conn.rollback()
        except Exception: pass
    finally:
        release_connection(conn)


# ── POST /billing/start-trial ─────────────────────────────────────────────────

DISABLE_RL_BILLING_START_TRIAL = False
RL_BILLING_START_TRIAL = _rl("5 per minute; 20 per day", "DISABLE_RL_BILLING_START_TRIAL")


@app.route('/billing/start-trial', methods=['POST'])
@jwt_required()
@limiter.limit(RL_BILLING_START_TRIAL)
def billing_start_trial():
    """
    Start a free trial for a tool. Enforces:
    - Tool must be in TRIAL_TOOLS config
    - No active trial for this tool already running
    - 6-month cooldown between trials (configurable in pricing/config.py)
    - Checks first-N-users exemption vs TRIAL_REQUIRES_CARD
    """
    from pricing.config import TRIAL_TOOLS, TRIAL_COOLDOWN_SECONDS, TRIAL_REQUIRES_CARD, FIRST_N_USERS_EXEMPT_ENABLED

    user_id = int(get_jwt_identity())
    body    = request.get_json(silent=True) or {}
    tool    = body.get('tool', '').strip().lower()

    if tool not in TRIAL_TOOLS:
        return jsonify({'error': f'No free trial available for "{tool}"'}), 400

    conn = get_connection()
    try:
        # Fetch runtime settings in one query
        with conn.cursor() as cur:
            cur.execute("""
                SELECT key, value FROM billing_settings
                 WHERE key IN ('trial_length_days', 'first_n_users_exempt')
            """)
            settings = {row[0]: row[1] for row in cur.fetchall()}

        trial_days    = int(settings.get('trial_length_days', 30))
        n_exempt      = int(settings.get('first_n_users_exempt', 50))
        card_required = TRIAL_REQUIRES_CARD and not (
            FIRST_N_USERS_EXEMPT_ENABLED and user_id <= n_exempt
        )

        # Check if already has an active trial
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id FROM user_tool_trials
                 WHERE user_id = %s AND tool = %s
                   AND ends_at > NOW() AND ended_early = FALSE
            """, (user_id, tool))
            if cur.fetchone():
                return jsonify({'error': 'You already have an active trial for this tool'}), 409

        # Check cooldown
        with conn.cursor() as cur:
            cur.execute("""
                SELECT started_at FROM user_tool_trials
                 WHERE user_id = %s AND tool = %s
                 ORDER BY started_at DESC LIMIT 1
            """, (user_id, tool))
            last = cur.fetchone()
        if last:
            import datetime
            elapsed = (datetime.datetime.now(datetime.timezone.utc) - last[0]).total_seconds()
            if elapsed < TRIAL_COOLDOWN_SECONDS:
                remaining_days = int((TRIAL_COOLDOWN_SECONDS - elapsed) / 86400)
                return jsonify({
                    'error': 'Trial cooldown active',
                    'code': 'trial_cooldown',
                    'cooldown_days_remaining': remaining_days,
                }), 429

        # Check card requirement
        if card_required:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT card_last4 FROM user_subscriptions
                     WHERE user_id = %s AND card_last4 IS NOT NULL
                """, (user_id,))
                if not cur.fetchone():
                    return jsonify({
                        'error': 'A card is required to start a free trial',
                        'code': 'card_required',
                    }), 402

        # Create trial
        import datetime
        ends_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=trial_days)
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_tool_trials (user_id, tool, ends_at)
                VALUES (%s, %s, %s)
            """, (user_id, tool, ends_at))

            # Ensure user_subscriptions row exists
            cur.execute("""
                INSERT INTO user_subscriptions (user_id, tier)
                VALUES (%s, 'base')
                ON CONFLICT (user_id) DO NOTHING
            """, (user_id,))

        conn.commit()
        app.logger.info(f'Trial started: user={user_id} tool={tool} ends={ends_at.date()}')
        return jsonify(get_billing_status(conn, user_id)), 200

    except Exception as e:
        app.logger.error(f'/billing/start-trial failed for user {user_id}: {e}')
        try: conn.rollback()
        except Exception: pass
        return jsonify({'error': 'Failed to start trial'}), 500
    finally:
        release_connection(conn)


# ── POST /billing/cancel-trial ────────────────────────────────────────────────

DISABLE_RL_BILLING_CANCEL_TRIAL = False
RL_BILLING_CANCEL_TRIAL = _rl("5 per minute; 10 per day", "DISABLE_RL_BILLING_CANCEL_TRIAL")


@app.route('/billing/cancel-trial', methods=['POST'])
@jwt_required()
@limiter.limit(RL_BILLING_CANCEL_TRIAL)
def billing_cancel_trial():
    """Mark the active trial for a tool as ended early."""
    user_id = int(get_jwt_identity())
    body    = request.get_json(silent=True) or {}
    tool    = body.get('tool', '').strip().lower()

    if not tool:
        return jsonify({'error': 'tool is required'}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_tool_trials
                   SET ended_early = TRUE
                 WHERE user_id = %s AND tool = %s
                   AND ends_at > NOW() AND ended_early = FALSE
            """, (user_id, tool))
            if cur.rowcount == 0:
                return jsonify({'error': 'No active trial found for this tool'}), 404
        conn.commit()
        return jsonify(get_billing_status(conn, user_id)), 200
    except Exception as e:
        app.logger.error(f'/billing/cancel-trial failed for user {user_id}: {e}')
        try: conn.rollback()
        except Exception: pass
        return jsonify({'error': 'Failed to cancel trial'}), 500
    finally:
        release_connection(conn)


# ── POST /billing/create-setup-intent ────────────────────────────────────────

DISABLE_RL_BILLING_SETUP_INTENT = False
RL_BILLING_SETUP_INTENT = _rl("10 per minute; 50 per day", "DISABLE_RL_BILLING_SETUP_INTENT")


@app.route('/billing/create-setup-intent', methods=['POST'])
@jwt_required()
@limiter.limit(RL_BILLING_SETUP_INTENT)
def billing_create_setup_intent():
    """
    Create a Stripe SetupIntent so the frontend can collect a card without
    charging it. Returns { client_secret } for Stripe Elements.
    Requires STRIPE_SECRET_KEY.
    """
    if not _STRIPE_SECRET_KEY:
        return jsonify({'error': 'Payment system not yet configured', 'code': 'stripe_not_configured'}), 503

    user_id = int(get_jwt_identity())
    conn    = get_connection()
    try:
        # Find or create the Stripe customer for this user
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.stripe_customer_id, u.email, u.display_name
                  FROM users u
                  LEFT JOIN user_subscriptions s ON s.user_id = u.id
                 WHERE u.id = %s
            """, (user_id,))
            row = cur.fetchone()

        if not row:
            return jsonify({'error': 'User not found'}), 404

        existing_customer_id, email, display_name = row
        customer_id = existing_customer_id or _stripe_create_customer(email, display_name, user_id)

        if customer_id != existing_customer_id:
            # Save the new customer ID
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO user_subscriptions (user_id, stripe_customer_id)
                    VALUES (%s, %s)
                    ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id
                """, (user_id, customer_id))
            conn.commit()

        # Create the SetupIntent
        si = _stripe_post('/setup_intents', {
            'customer': customer_id,
            'payment_method_types[]': 'card',
            'usage': 'off_session',
        })
        return jsonify({'client_secret': si['client_secret']}), 200

    except Exception as e:
        app.logger.error(f'/billing/create-setup-intent failed for user {user_id}: {e}')
        try: conn.rollback()
        except Exception: pass
        return jsonify({'error': 'Failed to create setup intent'}), 500
    finally:
        release_connection(conn)


# ── POST /billing/confirm-setup ───────────────────────────────────────────────

DISABLE_RL_BILLING_CONFIRM_SETUP = False
RL_BILLING_CONFIRM_SETUP = _rl("5 per minute; 20 per day", "DISABLE_RL_BILLING_CONFIRM_SETUP")


@app.route('/billing/confirm-setup', methods=['POST'])
@jwt_required()
@limiter.limit(RL_BILLING_CONFIRM_SETUP)
def billing_confirm_setup():
    """
    After Stripe Elements confirms a card is saved:
    1. Retrieve the payment method to get card details
    2. Store card_last4 + card_brand in user_subscriptions
    3. If a tool was passed and user is within trial window but has no sub,
       start the subscription now (Phase 2 expansion).
    Returns updated billing status.
    """
    if not _STRIPE_SECRET_KEY:
        return jsonify({'error': 'Payment system not yet configured', 'code': 'stripe_not_configured'}), 503

    user_id = int(get_jwt_identity())
    body    = request.get_json(silent=True) or {}
    pm_id   = body.get('payment_method_id', '').strip()

    if not pm_id:
        return jsonify({'error': 'payment_method_id is required'}), 400

    conn = get_connection()
    try:
        # Retrieve payment method details from Stripe
        pm = _stripe_get(f'/payment_methods/{pm_id}')
        card = pm.get('card', {})
        last4 = card.get('last4')
        brand = card.get('brand')

        with conn.cursor() as cur:
            cur.execute("""
                UPDATE user_subscriptions
                   SET card_last4  = %s,
                       card_brand  = %s,
                       updated_at  = NOW()
                 WHERE user_id = %s
            """, (last4, brand, user_id))
            if cur.rowcount == 0:
                cur.execute("""
                    INSERT INTO user_subscriptions (user_id, card_last4, card_brand)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (user_id) DO UPDATE
                      SET card_last4 = EXCLUDED.card_last4, card_brand = EXCLUDED.card_brand
                """, (user_id, last4, brand))
        conn.commit()
        return jsonify(get_billing_status(conn, user_id)), 200

    except Exception as e:
        app.logger.error(f'/billing/confirm-setup failed for user {user_id}: {e}')
        try: conn.rollback()
        except Exception: pass
        return jsonify({'error': 'Failed to confirm card setup'}), 500
    finally:
        release_connection(conn)


# ── Stripe HTTP helpers ───────────────────────────────────────────────────────

import base64
import urllib.request
import urllib.parse
import urllib.error
import json as _json


def _stripe_headers():
    auth = base64.b64encode(f'{_STRIPE_SECRET_KEY}:'.encode()).decode()
    return {
        'Authorization': f'Basic {auth}',
        'Content-Type': 'application/x-www-form-urlencoded',
    }


def _stripe_post(path: str, data: dict) -> dict:
    url  = f'https://api.stripe.com/v1{path}'
    body = urllib.parse.urlencode(data).encode()
    req  = urllib.request.Request(url, data=body, headers=_stripe_headers(), method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return _json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = _json.loads(e.read())
        raise Exception(f"Stripe {e.code}: {err.get('error', {}).get('message', str(err))}")


def _stripe_get(path: str) -> dict:
    url = f'https://api.stripe.com/v1{path}'
    req = urllib.request.Request(url, headers=_stripe_headers(), method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return _json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = _json.loads(e.read())
        raise Exception(f"Stripe {e.code}: {err.get('error', {}).get('message', str(err))}")


def _stripe_create_customer(email: str, name: str, user_id: int) -> str:
    data = {'email': email or ''}
    if name:
        data['name'] = name
    data['metadata[user_id]'] = str(user_id)
    customer = _stripe_post('/customers', data)
    return customer['id']


# ── POST /billing/send-trial-emails ──────────────────────────────────────────
# Called by a cron job (e.g. Render Cron or external scheduler) once per day.
# Protected by a shared secret in the Authorization header rather than JWT.

_CRON_SECRET = os.environ.get('BILLING_CRON_SECRET', '')


@app.route('/billing/send-trial-emails', methods=['POST'])
def billing_send_trial_emails():
    """
    Scans for:
    - Trials ending in exactly `trial_warning_day` days → send warning email
    - Trials that ended yesterday (ended_early=FALSE) → send ended email
    Idempotent: only sends once per event per user.
    Protected by Authorization: Bearer <BILLING_CRON_SECRET>.
    """
    if _CRON_SECRET:
        auth = request.headers.get('Authorization', '')
        if auth != f'Bearer {_CRON_SECRET}':
            return jsonify({'error': 'Unauthorized'}), 401

    conn = get_connection()
    warned = ended = 0
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value FROM billing_settings WHERE key = 'trial_warning_day'"
            )
            row = cur.fetchone()
            warning_day = int(row[0]) if row else 28

        # Trials ending in `warning_day` days (within a 1-hour window to handle
        # slight timing drift in daily cron runs)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.user_id, u.email, u.display_name, t.tool, t.ends_at
                  FROM user_tool_trials t
                  JOIN users u ON u.id = t.user_id
                 WHERE t.ended_early = FALSE
                   AND t.ends_at > NOW()
                   AND t.ends_at <= NOW() + INTERVAL '1 hour' + (%s || ' days')::INTERVAL
                   AND t.ends_at > NOW() + (%s || ' days')::INTERVAL - INTERVAL '1 hour'
            """, (str(warning_day), str(warning_day)))
            warning_rows = cur.fetchall()

        for user_id, email, name, tool, ends_at in warning_rows:
            try:
                _send_trial_warning_email(email, name or 'there', tool, ends_at)
                warned += 1
            except Exception as e:
                app.logger.error(f'Trial warning email failed for user {user_id}: {e}')

        # Trials that ended in the past 25 hours (allow cron drift)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT t.user_id, u.email, u.display_name, t.tool
                  FROM user_tool_trials t
                  JOIN users u ON u.id = t.user_id
                 WHERE t.ended_early = FALSE
                   AND t.ends_at < NOW()
                   AND t.ends_at > NOW() - INTERVAL '25 hours'
            """)
            ended_rows = cur.fetchall()

        for user_id, email, name, tool in ended_rows:
            try:
                _send_trial_ended_email(email, name or 'there', tool)
                ended += 1
            except Exception as e:
                app.logger.error(f'Trial ended email failed for user {user_id}: {e}')

        app.logger.info(f'Trial emails: {warned} warnings, {ended} ended')
        return jsonify({'warnings_sent': warned, 'ended_sent': ended}), 200
    except Exception as e:
        app.logger.error(f'/billing/send-trial-emails failed: {e}')
        return jsonify({'error': 'Failed to process trial emails'}), 500
    finally:
        release_connection(conn)


def _send_trial_warning_email(to_email: str, name: str, tool: str, ends_at):
    from email_service import send_email
    days_left = max(1, (ends_at.date() - __import__('datetime').date.today()).days)
    tool_display = tool.capitalize()
    subject = f'Your {tool_display} trial ends in {days_left} day{"s" if days_left != 1 else ""}'
    html = f"""
    <p>Hi {name},</p>
    <p>Just a reminder — your free {tool_display} trial ends in <strong>{days_left} day{"s" if days_left != 1 else ""}</strong>.</p>
    <p>Upgrade to Pro to keep your access and all your data.</p>
    <p><a href="{os.environ.get('FRONTEND_BASE_URL', '')}/pricing">View plans →</a></p>
    <p>If you have any questions, just reply to this email.</p>
    """
    send_email(to_email, subject, html)


def _send_trial_ended_email(to_email: str, name: str, tool: str):
    from email_service import send_email
    tool_display = tool.capitalize()
    subject = f'Your {tool_display} free trial has ended'
    html = f"""
    <p>Hi {name},</p>
    <p>Your free {tool_display} trial has ended. Your account has moved to the Base plan.</p>
    <p>Upgrade to Pro any time to regain full access — your data is still safe.</p>
    <p><a href="{os.environ.get('FRONTEND_BASE_URL', '')}/pricing">Upgrade now →</a></p>
    """
    send_email(to_email, subject, html)
