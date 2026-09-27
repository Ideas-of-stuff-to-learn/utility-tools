"""
geo.py

GeoIP lookup and impossible-travel detection for the admin panel.

Public API:
  check_geo_at_login(admin_user_id, ip, conn)
    → (allowed: bool, geo_blocked: bool, message: str, outcome: str)
    Call during verify-totp (BEFORE issuing session tokens).
    Checks allowlist first, then impossible travel.
    Logs to geo_lookup_log and updates admin_users geo columns.

  check_geo_heartbeat(admin_user_id, ip, jti, conn)
    → (allowed: bool, message: str, outcome: str)
    Call from POST /admin/geo/heartbeat (session already valid).
    Checks impossible travel only. If blocked: revokes session, increments
    strikes, sends email alert.

  geo_log_count(days=1, conn=None)
    → int — total lookups in the past N days (for rate-limit monitoring).
"""
import os
import json
import math
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

from database import get_connection, release_connection

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

_ALLOWLIST_RAW = os.environ.get('ADMIN_GEO_ALLOWLIST', '')
_ALLOWLIST = {c.strip().upper() for c in _ALLOWLIST_RAW.split(',') if c.strip()}

_MAX_SPEED_KMH = 900       # maximum commercial aircraft cruising speed
_MAX_STRIKES   = 5         # lock account permanently after this many strikes in 24h
_BASE_LOCKOUT_MINUTES = 15 # strike 1 → 15 min, strike 2 → 30 min, strike 3 → 60 min …
_STRIKE_WINDOW_HOURS  = 24

# ── Country centroids ─────────────────────────────────────────────────────────

_CENTROIDS_PATH = Path(__file__).parent / 'data' / 'country_centroids.json'
_centroids = None


def _get_centroids():
    global _centroids
    if _centroids is None:
        with open(_CENTROIDS_PATH) as f:
            _centroids = json.load(f)
    return _centroids


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _min_travel_hours(country_a, country_b):
    """Minimum physically possible travel time between two country centroids."""
    centroids = _get_centroids()
    c1 = centroids.get(country_a)
    c2 = centroids.get(country_b)
    if not c1 or not c2:
        return 0.0
    dist = _haversine_km(c1['lat'], c1['lng'], c2['lat'], c2['lng'])
    return dist / _MAX_SPEED_KMH


# ── ip-api.com lookup ─────────────────────────────────────────────────────────

def _lookup_ip_raw(ip):
    """Returns {'country_code': str, 'continent_code': str} or None on failure."""
    try:
        r = requests.get(
            f'http://ip-api.com/json/{ip}',
            params={'fields': 'status,message,countryCode,continentCode'},
            timeout=5,
        )
        data = r.json()
        if data.get('status') == 'success':
            return {
                'country_code':   data.get('countryCode', '') or '',
                'continent_code': data.get('continentCode', '') or '',
            }
    except Exception as e:
        logger.warning('ip-api lookup failed for %s: %s', ip, e)
    return None


# ── DB helpers ────────────────────────────────────────────────────────────────

def _log_geo(conn, admin_user_id, ip, trigger, country_code, continent_code, outcome):
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO geo_lookup_log
               (admin_user_id, ip_address, trigger, country_code, continent_code, outcome)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (admin_user_id, ip, trigger, country_code or '', continent_code or '', outcome),
        )


def _get_admin_geo_state(conn, admin_user_id):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT last_geo_country, last_geo_continent, last_geo_checked_at,
                      suspicious_strike_count, last_suspicious_at
               FROM admin_users WHERE id = %s""",
            (admin_user_id,),
        )
        return cur.fetchone()


def _update_last_geo(conn, admin_user_id, country_code, continent_code):
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE admin_users
               SET last_geo_country = %s, last_geo_continent = %s, last_geo_checked_at = now()
               WHERE id = %s""",
            (country_code, continent_code, admin_user_id),
        )


def _get_owner_email(conn):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT u.email FROM users u
               JOIN roles r ON u.role_id = r.id
               WHERE r.name = 'owner' AND u.email IS NOT NULL LIMIT 1"""
        )
        row = cur.fetchone()
    return row[0] if row else None


def _get_admin_username(conn, admin_user_id):
    with conn.cursor() as cur:
        cur.execute("SELECT username FROM admin_users WHERE id = %s", (admin_user_id,))
        row = cur.fetchone()
    return row[0] if row else str(admin_user_id)


# ── Strike / lockout ──────────────────────────────────────────────────────────

def _compute_lockout_minutes(strike_count):
    """Exponential: 15 → 30 → 60 → 120 → 240 min."""
    return min(_BASE_LOCKOUT_MINUTES * (2 ** (strike_count - 1)), 24 * 60)


def _handle_suspicious(admin_user_id, jti, reason, ip, new_country, new_continent, conn):
    """Increment strikes, set lockout, revoke session, send email.
    Returns (lockout_minutes, permanently_locked)."""
    from email_service import send_email

    row = _get_admin_geo_state(conn, admin_user_id)
    if not row:
        return 0, False

    last_country, last_continent, _, strike_count, last_suspicious_at = row

    # Reset strikes if last suspicious was > 24 hours ago
    now = datetime.now(timezone.utc)
    if last_suspicious_at and (now - last_suspicious_at) > timedelta(hours=_STRIKE_WINDOW_HOURS):
        strike_count = 0

    strike_count += 1
    permanently_locked = strike_count >= _MAX_STRIKES
    lockout_minutes = _compute_lockout_minutes(strike_count)

    with conn.cursor() as cur:
        if permanently_locked:
            cur.execute(
                """UPDATE admin_users
                   SET suspicious_strike_count = %s,
                       last_suspicious_at      = now(),
                       login_locked            = true,
                       failed_attempts         = 0,
                       locked_until            = NULL
                   WHERE id = %s""",
                (strike_count, admin_user_id),
            )
        else:
            cur.execute(
                """UPDATE admin_users
                   SET suspicious_strike_count = %s,
                       last_suspicious_at      = now(),
                       locked_until            = now() + interval '%s minutes'
                   WHERE id = %s""",
                (strike_count, lockout_minutes, admin_user_id),
            )

    # Revoke the session JTI if provided
    if jti:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO revoked_tokens (jti) VALUES (%s) ON CONFLICT DO NOTHING",
                (jti,),
            )

    # Email owner
    username = _get_admin_username(conn, admin_user_id)
    owner_email = _get_owner_email(conn)
    if owner_email:
        lockout_str = 'PERMANENTLY LOCKED (requires admin unlock)' if permanently_locked else f'{lockout_minutes} minutes'
        elapsed_note = f'from {last_country} ({last_continent}) → {new_country} ({new_continent})' if last_country else new_country
        html = f"""
<h2 style="color:#c0392b;">⚠️ Suspicious Geo Activity Detected</h2>
<p>Admin account <strong>{username}</strong> was logged out due to suspicious geographic activity.</p>
<table style="border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0"><strong>Reason</strong></td><td>{reason}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>IP</strong></td><td>{ip}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Location change</strong></td><td>{elapsed_note}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Strike count</strong></td><td>{strike_count} / {_MAX_STRIKES}</td></tr>
  <tr><td style="padding:4px 12px 4px 0"><strong>Account locked</strong></td><td>{lockout_str}</td></tr>
</table>
<p style="margin-top:16px;font-size:13px;color:#555;">
  If this is the legitimate account holder, the lockout expires automatically (or the account can be unlocked by a higher-privilege admin, or directly in the database by resetting suspicious_strike_count and locked_until).
</p>
"""
        text = (
            f'Suspicious geo activity: admin account {username} locked.\n'
            f'Reason: {reason}\nIP: {ip}\nLocation: {elapsed_note}\n'
            f'Strikes: {strike_count}/{_MAX_STRIKES}\nLocked for: {lockout_str}'
        )
        try:
            send_email(
                to_address=owner_email,
                subject=f'⚠️ Suspicious geo activity — admin account {username}',
                html_body=html,
                text_body=text,
            )
        except Exception as e:
            logger.error('Failed to send suspicious-geo email: %s', e)

    return lockout_minutes, permanently_locked


def _build_in_app_message(reason, lockout_minutes, permanently_locked, strike_count):
    """Returns bullet-point message shown in the admin login screen alert."""
    lockout_str = 'Account permanently locked — contact a higher-privilege admin' if permanently_locked else f'{lockout_minutes}-minute lockout in effect'
    strikes_remaining = max(0, _MAX_STRIKES - strike_count)
    return (
        f'Suspicious activity detected — you have been logged out.\n'
        f'• Reason: {reason}\n'
        f'• {lockout_str}\n'
        f'• {strikes_remaining} more detection(s) within 24 h will permanently lock this account\n'
        f'• Lockout window resets after 24 hours of no suspicious activity\n'
        f'• To unlock: wait for expiry, ask a higher-privilege admin, or reset directly in the database'
    )


# ── Impossible travel check ───────────────────────────────────────────────────

def _is_impossible_travel(last_country, last_continent, last_checked_at, new_country, new_continent):
    """Returns (blocked: bool, reason: str)."""
    if not last_country or not last_checked_at:
        return False, ''
    if new_country == last_country:
        return False, ''

    now = datetime.now(timezone.utc)
    elapsed_hours = (now - last_checked_at).total_seconds() / 3600

    # Different continent in under 1 hour → always block
    if new_continent and last_continent and new_continent != last_continent and elapsed_hours < 1.0:
        return True, f'Continent change ({last_continent}→{new_continent}) in {elapsed_hours:.1f}h'

    # Check haversine minimum travel time
    min_hours = _min_travel_hours(last_country, new_country)
    if min_hours > 0 and elapsed_hours < min_hours:
        return True, (
            f'Impossible travel: {last_country}→{new_country} '
            f'in {elapsed_hours:.1f}h (min {min_hours:.1f}h by air)'
        )

    return False, ''


# ── Public API ────────────────────────────────────────────────────────────────

def check_geo_at_login(admin_user_id, ip, conn):
    """
    Called during verify-totp BEFORE session tokens are issued.
    Returns (allowed, geo_blocked, message, outcome).

    If not allowed: do NOT issue session tokens.
    If allowed: issue tokens normally.
    """
    geo = _lookup_ip_raw(ip)
    if geo is None:
        # API error — log and allow (fail open so API downtime doesn't lock out owner)
        _log_geo(conn, admin_user_id, ip, 'login', '', '', 'api_error')
        logger.warning('GeoIP lookup failed at login for admin %s — allowing (fail-open)', admin_user_id)
        return True, False, '', 'api_error'

    country  = geo['country_code']
    continent = geo['continent_code']

    # 1. Allowlist check
    if _ALLOWLIST and country not in _ALLOWLIST:
        _log_geo(conn, admin_user_id, ip, 'login', country, continent, 'blocked_allowlist')
        _update_last_geo(conn, admin_user_id, country, continent)
        msg = f'Login blocked: country {country} is not in the allowlist.'
        return False, True, msg, 'blocked_allowlist'

    # 2. Impossible travel
    row = _get_admin_geo_state(conn, admin_user_id)
    if row:
        last_country, last_continent, last_checked_at, strike_count, last_suspicious_at = row

        # If strikes were manually cleared from DB while last_suspicious_at is recent,
        # skip impossible-travel check (DB override) and just update geo
        now = datetime.now(timezone.utc)
        db_override = (
            strike_count == 0
            and last_suspicious_at is not None
            and (now - last_suspicious_at) < timedelta(hours=_STRIKE_WINDOW_HOURS)
        )

        if not db_override:
            blocked, reason = _is_impossible_travel(
                last_country, last_continent, last_checked_at, country, continent
            )
            if blocked:
                # For login blocks we don't have a JTI yet — pass None
                lockout_minutes, permanently_locked = _handle_suspicious(
                    admin_user_id, None, reason, ip, country, continent, conn
                )
                _log_geo(conn, admin_user_id, ip, 'login', country, continent, 'blocked_travel')
                _update_last_geo(conn, admin_user_id, country, continent)
                msg = _build_in_app_message(reason, lockout_minutes, permanently_locked,
                                            row[3] + 1 if row else 1)
                return False, True, msg, 'blocked_travel'

    # 3. Country changed (allowed, just different country)
    outcome = 'country_changed' if row and row[0] and row[0] != country else 'allowed'
    _log_geo(conn, admin_user_id, ip, 'login', country, continent, outcome)
    _update_last_geo(conn, admin_user_id, country, continent)
    return True, False, '', outcome


def check_geo_heartbeat(admin_user_id, ip, jti, conn, trigger='heartbeat'):
    """
    Called from heartbeat / page-focus endpoints (session already valid).
    Returns (allowed, message, outcome).

    If not allowed: session has been revoked; frontend should show alert and logout.
    """
    geo = _lookup_ip_raw(ip)
    if geo is None:
        _log_geo(conn, admin_user_id, ip, trigger, '', '', 'api_error')
        logger.warning('GeoIP lookup failed at %s for admin %s — allowing (fail-open)', trigger, admin_user_id)
        return True, '', 'api_error'

    country   = geo['country_code']
    continent = geo['continent_code']

    row = _get_admin_geo_state(conn, admin_user_id)
    if row:
        last_country, last_continent, last_checked_at, strike_count, last_suspicious_at = row

        now = datetime.now(timezone.utc)
        db_override = (
            strike_count == 0
            and last_suspicious_at is not None
            and (now - last_suspicious_at) < timedelta(hours=_STRIKE_WINDOW_HOURS)
        )

        if not db_override:
            blocked, reason = _is_impossible_travel(
                last_country, last_continent, last_checked_at, country, continent
            )
            if blocked:
                lockout_minutes, permanently_locked = _handle_suspicious(
                    admin_user_id, jti, reason, ip, country, continent, conn
                )
                _log_geo(conn, admin_user_id, ip, trigger, country, continent, 'blocked_travel')
                _update_last_geo(conn, admin_user_id, country, continent)
                msg = _build_in_app_message(reason, lockout_minutes, permanently_locked,
                                            row[3] + 1 if row else 1)
                return False, msg, 'blocked_travel'

    outcome = 'country_changed' if row and row[0] and row[0] != country else 'allowed'
    _log_geo(conn, admin_user_id, ip, trigger, country, continent, outcome)
    _update_last_geo(conn, admin_user_id, country, continent)
    return True, '', outcome


def geo_log_count(days=1, conn=None):
    """Total geo lookups in the past N days. Useful for rate-limit monitoring."""
    own_conn = conn is None
    if own_conn:
        conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM geo_lookup_log WHERE created_at > now() - interval '%s days'",
                (days,),
            )
            return cur.fetchone()[0]
    finally:
        if own_conn:
            release_connection(conn)
