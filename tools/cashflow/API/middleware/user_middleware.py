"""
middleware/user_middleware.py

All route guards and permission/role business logic for regular (Cashflow
+ landing) routes.

  require_permission(key)      — decorator: assumes @jwt_required() already ran
  require_auth(key=None)       — decorator: bundles @jwt_required() + permission
                                 check in one annotation; use for new routes

HMAC is handled upstream by the before_request hook in extensions.py —
no per-route annotation needed.

Admin equivalents live in middleware/admin_middleware.py.
"""

from functools import wraps

from flask import jsonify, g
from flask_jwt_extended import get_jwt_identity, get_jwt, jwt_required

from database import get_connection, release_connection


# Owner tier is a hard ceiling — see docstring below for why this is
# structural, not a seeded row.
OWNER_ROLE_NAME = 'owner'


def get_user_role_and_permissions(conn, user_id):
    """Returns (role_name, level, permission_keys) for a user.

    permission_keys is a set: the role's own bundled permissions, PLUS
    any user_permission_overrides row with granted=true, MINUS any
    override row with granted=false. Falls back to ('user', 0, set())
    if the user's role_id is somehow unset.
    """
    with conn.cursor() as cur:
        cur.execute(
            """SELECT r.name, r.level
               FROM users u JOIN roles r ON u.role_id = r.id
               WHERE u.id = %s""",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return 'user', 0, set()
    role_name, level = row

    with conn.cursor() as cur:
        cur.execute(
            """SELECT p.key FROM role_permissions rp
               JOIN permissions p ON rp.permission_id = p.id
               JOIN users u ON u.role_id = rp.role_id
               WHERE u.id = %s""",
            (user_id,),
        )
        perms = {r[0] for r in cur.fetchall()}

    with conn.cursor() as cur:
        cur.execute(
            """SELECT p.key, o.granted FROM user_permission_overrides o
               JOIN permissions p ON o.permission_id = p.id
               WHERE o.user_id = %s""",
            (user_id,),
        )
        for key, granted in cur.fetchall():
            if granted:
                perms.add(key)
            else:
                perms.discard(key)

    return role_name, level, perms


def user_has_permission(conn, user_id, permission_key):
    """The actual authorization check. Owner always passes."""
    role_name, _level, perms = get_user_role_and_permissions(conn, user_id)
    if role_name == OWNER_ROLE_NAME:
        return True
    return permission_key in perms


def require_permission(permission_key):
    """Route decorator. Place it AFTER @jwt_required()."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            current_user = int(get_jwt_identity())
            conn = get_connection()
            try:
                if not user_has_permission(conn, current_user, permission_key):
                    return jsonify({'error': 'Not authorized'}), 403
            finally:
                release_connection(conn)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def require_auth(permission_key=None, tool='cashflow'):
    """Combined decorator: bundles @jwt_required() + tools-claim check +
    optional permission check into one annotation.

        @app.route(...)
        @require_auth('categories.rename')
        @limiter.limit(RL_...)
        def view(): ...

    Pass None (or no argument) for routes that need auth but have no
    specific permission gate.
    """
    def decorator(fn):
        @wraps(fn)
        @jwt_required()
        def wrapper(*args, **kwargs):
            claims = get_jwt()
            if tool not in claims.get('tools', []):
                return jsonify({'error': 'Subscription required', 'code': 'no_tool_access'}), 403
            if permission_key:
                current_user = int(get_jwt_identity())
                conn = get_connection()
                try:
                    if not user_has_permission(conn, current_user, permission_key):
                        return jsonify({'error': 'Not authorized'}), 403
                finally:
                    release_connection(conn)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ── Read helpers ──────────────────────────────────────────────────────────────

def list_all_permissions(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT key, description FROM permissions ORDER BY key")
        return [{'key': row[0], 'description': row[1]} for row in cur.fetchall()]


def list_all_roles(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, level, pending_deletion_at FROM roles ORDER BY level DESC")
        roles = [
            {
                'id': row[0], 'name': row[1], 'level': row[2],
                'pending_deletion_at': row[3].isoformat() if row[3] else None,
            }
            for row in cur.fetchall()
        ]

    for role in roles:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT p.key FROM role_permissions rp
                   JOIN permissions p ON rp.permission_id = p.id
                   WHERE rp.role_id = %s ORDER BY p.key""",
                (role['id'],),
            )
            role['permissions'] = [r[0] for r in cur.fetchall()]

    return roles


def list_all_users(conn):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT u.id, u.username, r.name, r.level, u.email,
                      u.login_locked, u.login_locked_until, u.failed_login_attempts
               FROM users u LEFT JOIN roles r ON u.role_id = r.id
               ORDER BY r.level DESC NULLS LAST, u.username""",
        )
        rows = cur.fetchall()

    users = []
    for user_id, username, role_name, role_level, email, login_locked, login_locked_until, failed_attempts in rows:
        _role_name, _level, perms = get_user_role_and_permissions(conn, user_id)
        users.append({
            'id': user_id,
            'username': username,
            'role': role_name or 'user',
            'level': role_level if role_level is not None else 0,
            'email': email,
            'login_locked': bool(login_locked),
            'login_locked_until': login_locked_until.isoformat() if login_locked_until else None,
            'failed_login_attempts': failed_attempts or 0,
            'permissions': sorted(perms),
        })
    return users


def get_role_by_name(conn, name):
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, level FROM roles WHERE name = %s", (name,))
        row = cur.fetchone()
        return {'id': row[0], 'name': row[1], 'level': row[2]} if row else None


def get_role_by_id(conn, role_id):
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, level FROM roles WHERE id = %s", (role_id,))
        row = cur.fetchone()
        return {'id': row[0], 'name': row[1], 'level': row[2]} if row else None


PROTECTED_ROLE_NAMES = {'owner', 'admin', 'user'}


# ── Write helpers ─────────────────────────────────────────────────────────────

def create_role(conn, name, level, permission_keys):
    name = (name or '').strip()
    if not name:
        raise ValueError('name is required')
    if name in PROTECTED_ROLE_NAMES:
        raise ValueError(f'"{name}" is a reserved role name')

    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM roles WHERE name = %s", (name,))
        if cur.fetchone():
            raise ValueError(f'Role "{name}" already exists')

        cur.execute(
            "INSERT INTO roles (name, level) VALUES (%s, %s) RETURNING id",
            (name, level),
        )
        role_id = cur.fetchone()[0]
        _set_role_permissions(cur, role_id, permission_keys)

    return {'id': role_id, 'name': name, 'level': level, 'permissions': sorted(permission_keys)}


def update_role(conn, role_id, level=None, permission_keys=None):
    role = get_role_by_id(conn, role_id)
    if not role:
        raise ValueError('Role not found')

    with conn.cursor() as cur:
        if level is not None:
            cur.execute("UPDATE roles SET level = %s WHERE id = %s", (level, role_id))
        if permission_keys is not None:
            _set_role_permissions(cur, role_id, permission_keys)

    return get_role_by_id(conn, role_id)


def _set_role_permissions(cur, role_id, permission_keys):
    cur.execute("DELETE FROM role_permissions WHERE role_id = %s", (role_id,))
    if permission_keys:
        cur.execute(
            """INSERT INTO role_permissions (role_id, permission_id)
               SELECT %s, id FROM permissions WHERE key = ANY(%s)""",
            (role_id, list(permission_keys)),
        )


def delete_role(conn, role_id):
    role = get_role_by_id(conn, role_id)
    if not role:
        raise ValueError('Role not found')
    if role['name'] in PROTECTED_ROLE_NAMES:
        raise ValueError(f'"{role["name"]}" is a protected role and cannot be deleted')

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM users WHERE role_id = %s", (role_id,))
        in_use_count = cur.fetchone()[0]
        if in_use_count:
            raise ValueError(f'{in_use_count} user(s) still have this role - reassign them first')

        cur.execute("DELETE FROM roles WHERE id = %s", (role_id,))


def get_user_level(conn, user_id):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT u.username, r.name, r.level
               FROM users u LEFT JOIN roles r ON u.role_id = r.id
               WHERE u.id = %s""",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    username, role_name, level = row
    return {'username': username, 'role': role_name or 'user', 'level': level if level is not None else 0}


def delete_user(conn, target_user_id):
    with conn.cursor() as cur:
        cur.execute("SELECT username FROM users WHERE id = %s", (target_user_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError('User not found')
        username = row[0]
        cur.execute("DELETE FROM users WHERE id = %s", (target_user_id,))
    return username


def update_user_credentials(conn, target_user_id, new_username=None, new_password_hash=None):
    if new_username is None and new_password_hash is None:
        raise ValueError('Provide a new username and/or password')

    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE id = %s", (target_user_id,))
        if not cur.fetchone():
            raise ValueError('User not found')

        if new_username is not None:
            cur.execute(
                "SELECT 1 FROM users WHERE username = %s AND id != %s",
                (new_username, target_user_id),
            )
            if cur.fetchone():
                raise ValueError(f'Username "{new_username}" is already taken')
            cur.execute("UPDATE users SET username = %s WHERE id = %s", (new_username, target_user_id))

        if new_password_hash is not None:
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_password_hash, target_user_id))

    return next(u for u in list_all_users(conn) if u['id'] == target_user_id)


def assign_user_role(conn, target_user_id, role_name):
    role = get_role_by_name(conn, role_name)
    if not role:
        raise ValueError(f'Role "{role_name}" not found')

    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE id = %s", (target_user_id,))
        if not cur.fetchone():
            raise ValueError('User not found')
        cur.execute("UPDATE users SET role_id = %s WHERE id = %s", (role['id'], target_user_id))

    return next(u for u in list_all_users(conn) if u['id'] == target_user_id)


def set_user_permission_override(conn, target_user_id, permission_key, granted):
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM permissions WHERE key = %s", (permission_key,))
        perm_row = cur.fetchone()
        if not perm_row:
            raise ValueError(f'Unknown permission "{permission_key}"')
        permission_id = perm_row[0]

        cur.execute("SELECT 1 FROM users WHERE id = %s", (target_user_id,))
        if not cur.fetchone():
            raise ValueError('User not found')

        if granted is None:
            cur.execute(
                "DELETE FROM user_permission_overrides WHERE user_id = %s AND permission_id = %s",
                (target_user_id, permission_id),
            )
        else:
            cur.execute(
                """INSERT INTO user_permission_overrides (user_id, permission_id, granted)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (user_id, permission_id) DO UPDATE SET granted = EXCLUDED.granted""",
                (target_user_id, permission_id, granted),
            )
