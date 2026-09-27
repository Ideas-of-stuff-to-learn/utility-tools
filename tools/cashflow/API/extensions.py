"""
extensions.py

The single place `app`, `jwt`, and `limiter` get created. Every route
module (routes/*.py) imports these three from here rather than each
creating its own - Flask/JWT/the rate limiter only make sense as ONE
shared instance the whole process registers routes against, not one
per file.

This is also why route modules use `@app.route(...)` directly (the
same shared Flask app object) rather than Blueprint objects - simpler,
and every route keeps its exact existing path/behavior with nothing to
re-wire (no url_prefix, no blueprint registration step to get subtly
wrong). backend.py is what actually imports every routes/*.py module
(causing their @app.route(...) decorators to run and register against
this same `app`), then re-exports `app` for gunicorn.
"""
import os
from datetime import timedelta
import sys
import psycopg2
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from flask import Flask
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from database import get_connection, release_connection
from backendLocalConfig import CORS_ORIGINS, LOCAL_DEV

load_dotenv()

app = Flask(__name__)
# Trust Render's single reverse-proxy hop so request.remote_addr reflects
# the real client IP rather than the load-balancer IP. Without this every
# request appears to come from the same IP and all users share one rate-limit
# bucket — making per-IP limits useless in production.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)



sys.path.append(os.path.join(os.path.dirname(__file__), '..'))


CORS(
    app,
    supports_credentials=True,
    origins=CORS_ORIGINS,
)


IS_LOCAL_DEV = LOCAL_DEV

app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY')

# Replaces the old JWT_ACCESS_TOKEN_EXPIRES = False (tokens that never
# expired at all, no matter which of login/signup/impersonate issued
# them - see handoff5.txt for why that was a real problem, not a
# theoretical one). Access tokens are now short-lived; refresh tokens
# (created via create_refresh_token(), used by /auth/refresh) are the
# longer-lived thing that lets the app/CLI silently obtain a new access
# token without asking for a password again, right up until the
# refresh token itself expires or is revoked.
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=24)
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=30)
#IS_LOCAL_DEV = os.environ.get('FLASK_ENV') == 'development'
app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies']  # both, so RN keeps working unchanged
app.config['JWT_COOKIE_SECURE'] = not IS_LOCAL_DEV
app.config['JWT_COOKIE_SAMESITE'] = 'Lax' if IS_LOCAL_DEV else 'None'
app.config['JWT_COOKIE_CSRF_PROTECT'] = True
app.config['JWT_ACCESS_COOKIE_NAME'] = 'access_token_cookie'
app.config['JWT_REFRESH_COOKIE_NAME'] = 'refresh_token_cookie'
app.config['JWT_CSRF_METHODS'] = ['POST', 'PUT', 'PATCH', 'DELETE']
# Deliberately much shorter than a normal access token, and passed
# explicitly as expires_delta on the ONE call site that uses it
# (admin_impersonate_user, in routes/admin.py) rather than being a
# global default - an impersonation session is a bounded admin task,
# not something that should be able to linger for a full day like an
# ordinary login.
IMPERSONATION_TOKEN_EXPIRES = timedelta(minutes=15)

jwt = JWTManager(app)


@jwt.token_in_blocklist_loader
def check_if_token_revoked(jwt_header, jwt_payload):
    """Runs automatically on EVERY @jwt_required()-protected request,
    right after signature verification succeeds - this is what makes
    revocation (POST /auth/logout, POST /admin/tokens/revoke) actually
    mean something, as opposed to inserting rows into a table nothing
    ever reads. A signature-valid-but-revoked token is rejected here
    with the same effect as an expired one."""
    jti = jwt_payload["jti"]
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM revoked_tokens WHERE jti = %s", (jti,))
            result = cur.fetchone() is not None
        release_connection(conn)
        return result
    except psycopg2.OperationalError:
        # SSL connection went stale after cold start — discard it and retry
        # once with a fresh connection. This clears the bad connection from
        # the pool so all subsequent requests in this process also get clean ones.
        release_connection(conn, discard=True)
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM revoked_tokens WHERE jti = %s", (jti,))
                return cur.fetchone() is not None
        finally:
            release_connection(conn)


limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[],
    storage_uri="memory://",
)


@app.after_request
def set_security_headers(response):
    """Attach security headers to every response."""
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = (
        "default-src 'none'; "
        "frame-ancestors 'none';"
    )
    return response


@app.before_request
def verify_hmac_for_authenticated_requests():
    """For any request that carries a valid user JWT cookie, verify the
    HMAC signature. Unauthenticated requests (no cookie) are skipped —
    they have no signing secret yet. Admin routes use require_admin_auth
    which has its own HMAC check; this covers the regular JWT routes."""
    import os
    from flask import request as req, jsonify as _jsonify
    from flask_jwt_extended import decode_token

    # Skip admin routes — handled by require_admin_auth
    if req.path.startswith('/admin/'):
        return

    token = req.cookies.get('access_token_cookie')
    if not token:
        return  # unauthenticated — skip

    try:
        data = decode_token(token)
    except Exception:
        return  # invalid token — let @jwt_required handle it

    from hmac_auth import verify_hmac_request
    user_id = data.get('sub', '')
    jti = data.get('jti', '')
    ok, reason = verify_hmac_request(req, str(user_id), jti)
    if not ok:
        return _jsonify({'error': f'HMAC verification failed: {reason}'}), 401


