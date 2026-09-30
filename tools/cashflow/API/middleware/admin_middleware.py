"""
middleware/admin_middleware.py

All route guards for the admin panel.

  require_admin_auth(permission_key=None)  — decorator: validates admin
      session cookie, checks revocation, checks permission, verifies HMAC.
      All in one; admin routes only need this + @limiter.limit().

  require_hmac                             — standalone decorator for
      regular JWT routes that need an explicit per-route HMAC check
      (the before_request hook in extensions.py handles the common case).

User/Cashflow equivalents live in middleware/user_middleware.py.
"""

from functools import wraps

from flask import jsonify, request, g
from flask_jwt_extended import get_jwt_identity, get_jwt, decode_token

from database import get_connection, release_connection
from hmac_auth import verify_hmac_request


def get_admin_role_and_permissions(conn, admin_user_id):
    """Like get_user_role_and_permissions but queries admin_users.
    Admin accounts have role-level permissions only (no per-user overrides)."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT r.name, r.level
               FROM admin_users au JOIN roles r ON au.role_id = r.id
               WHERE au.id = %s""",
            (admin_user_id,),
        )
        row = cur.fetchone()
    if not row:
        return 'user', 0, set()
    role_name, level = row

    with conn.cursor() as cur:
        cur.execute(
            """SELECT p.key FROM role_permissions rp
               JOIN permissions p ON rp.permission_id = p.id
               JOIN admin_users au ON au.role_id = rp.role_id
               WHERE au.id = %s""",
            (admin_user_id,),
        )
        perms = {r[0] for r in cur.fetchall()}

    return role_name, level, perms


def admin_user_has_permission(conn, admin_user_id, permission_key):
    role_name, _level, perms = get_admin_role_and_permissions(conn, admin_user_id)
    if role_name == 'owner':
        return True
    return permission_key in perms


def require_admin_auth(permission_key=None):
    """Decorator for admin panel routes.

    Validates the admin_access_token cookie, checks revocation,
    optionally checks a permission key, then verifies the HMAC signature.
    Sets g.admin_user_id and g.admin_token_jti for the wrapped function.

    Admin routes only need this + @limiter.limit():

        @app.route(...)
        @require_admin_auth('some.permission')
        @limiter.limit(RL_...)
        def view(): ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            token = request.cookies.get('admin_access_token')
            if not token:
                return jsonify({'error': 'Admin session required'}), 401
            try:
                data = decode_token(token)
            except Exception:
                return jsonify({'error': 'Admin session invalid or expired'}), 401

            if not data.get('admin_session'):
                return jsonify({'error': 'Admin session required'}), 401

            jti = data.get('jti')
            admin_user_id = int(data['sub'])

            conn = get_connection()
            try:
                if jti:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1 FROM revoked_tokens WHERE jti = %s", (jti,))
                        if cur.fetchone():
                            return jsonify({'error': 'Session revoked'}), 401

                if permission_key and not admin_user_has_permission(conn, admin_user_id, permission_key):
                    return jsonify({'error': 'Not authorized'}), 403
            finally:
                release_connection(conn)

            g.admin_user_id = admin_user_id
            g.admin_token_jti = jti

            ok, reason = verify_hmac_request(request, str(admin_user_id), jti or '')
            if not ok:
                return jsonify({'error': f'HMAC verification failed: {reason}'}), 401

            return fn(*args, **kwargs)
        return wrapper
    return decorator


def check_admin_auth(permission_key=None):
    """Imperative auth check for routes that can't use the decorator.
    Returns a Flask error response tuple on failure, or None on success.
    Also sets g.admin_user_id and g.admin_token_jti on success.
    """
    token = request.cookies.get('admin_access_token')
    if not token:
        return jsonify({'error': 'Admin session required'}), 401
    try:
        data = decode_token(token)
    except Exception:
        return jsonify({'error': 'Admin session invalid or expired'}), 401

    if not data.get('admin_session'):
        return jsonify({'error': 'Admin session required'}), 401

    jti = data.get('jti')
    admin_user_id = int(data['sub'])

    conn = get_connection()
    try:
        if jti:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM revoked_tokens WHERE jti = %s", (jti,))
                if cur.fetchone():
                    return jsonify({'error': 'Session revoked'}), 401

        if permission_key and not admin_user_has_permission(conn, admin_user_id, permission_key):
            return jsonify({'error': 'Not authorized'}), 403
    finally:
        release_connection(conn)

    g.admin_user_id = admin_user_id
    g.admin_token_jti = jti

    ok, reason = verify_hmac_request(request, str(admin_user_id), jti or '')
    if not ok:
        return jsonify({'error': f'HMAC verification failed: {reason}'}), 401

    return None


def require_hmac(fn):
    """Standalone decorator for regular JWT-protected routes that need
    an explicit per-route HMAC check. Must be applied AFTER @jwt_required().

    In most cases the before_request hook in extensions.py handles HMAC
    automatically — use this only when you need the check outside that hook's
    scope (e.g. a route that uses header-based JWT instead of a cookie)."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        claims = get_jwt()
        user_id = get_jwt_identity()
        jti = claims.get('jti', '')
        ok, reason = verify_hmac_request(request, str(user_id), jti)
        if not ok:
            return jsonify({'error': f'HMAC verification failed: {reason}'}), 401
        return fn(*args, **kwargs)
    return wrapper
