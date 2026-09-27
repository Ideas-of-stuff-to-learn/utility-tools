"""
hmac_auth.py

HMAC request signing helpers.

Flow:
  1. On login, derive_signing_secret(user_id, jti) produces a per-session
     secret from JWT_SECRET. The secret is returned once in the login JSON
     body and held in the frontend's JS memory. Nothing is stored server-side.
  2. Every authenticated request (GET and non-GET) includes:
       X-HMAC-Sig: hex(HMAC-SHA256(secret, timestamp:METHOD:path))
       X-HMAC-TS:  unix timestamp (seconds, integer)
  3. verify_hmac_request() re-derives the secret from the JWT claims already
     decoded by flask-jwt-extended and verifies the signature. Rejects if the
     timestamp is outside the allowed window or the signature doesn't match.
"""
import hashlib
import hmac as _hmac
import os
import time

_JWT_SECRET = None
_WINDOW_SECONDS = 30


def _get_jwt_secret():
    global _JWT_SECRET
    if _JWT_SECRET is None:
        _JWT_SECRET = os.environ.get('JWT_SECRET_KEY', '').encode('utf-8')
    return _JWT_SECRET


def derive_signing_secret(user_id: str, jti: str) -> str:
    """Derive a per-session HMAC signing secret from JWT_SECRET + identity.
    Deterministic — no storage needed. Returns a 64-char hex string."""
    key = _get_jwt_secret()
    msg = f"{user_id}:{jti}".encode('utf-8')
    return _hmac.new(key, msg, hashlib.sha256).hexdigest()


def compute_signature(secret_hex: str, timestamp: int, method: str, path: str) -> str:
    key = bytes.fromhex(secret_hex)
    msg = f"{timestamp}:{method.upper()}:{path}".encode('utf-8')
    return _hmac.new(key, msg, hashlib.sha256).hexdigest()


def verify_hmac_request(request, user_id: str, jti: str) -> tuple:
    """Verify the HMAC signature on an incoming request.
    Returns (ok: bool, reason: str). reason is empty on success."""
    sig_header = request.headers.get('X-HMAC-Sig', '')
    ts_header  = request.headers.get('X-HMAC-TS', '')

    if not sig_header or not ts_header:
        return False, 'Missing HMAC headers'

    try:
        ts = int(ts_header)
    except ValueError:
        return False, 'Invalid timestamp'

    now = int(time.time())
    if abs(now - ts) > _WINDOW_SECONDS:
        return False, f'Timestamp outside {_WINDOW_SECONDS}s window'

    secret = derive_signing_secret(str(user_id), jti)
    expected = compute_signature(secret, ts, request.method, request.path)

    if not _hmac.compare_digest(expected, sig_header.lower()):
        return False, 'Signature mismatch'

    return True, ''
