"""
permissions.py

The permission system: role + fine-grained-permission lookup, the
@require_permission(...) decorator every gated route uses, and the
plain functions the new /admin/* endpoints call to manage roles,
role-permission bundles, and per-user overrides.

Replaces the old pattern that used to be duplicated inline in every
admin-only endpoint in backend.py:
    cur.execute("SELECT username FROM users WHERE id = %s", (current_user,))
    if not row or row[0] != "admin":
        return jsonify({'error': 'Not authorized'}), 403

See schema.sql's "Permission system" section for the tables this reads
from (roles, permissions, role_permissions, user_permission_overrides)
and for the seed data / one-time backfill.
"""

from functools import wraps

from flask import jsonify, request, g
from flask_jwt_extended import get_jwt_identity, get_jwt, decode_token

from database import get_connection, release_connection
from hmac_auth import verify_hmac_request

# The owner tier is a hard ceiling, deliberately NOT implemented by
# seeding every permission row against an 'owner' role_permissions
# entry. user_has_permission() below special-cases this name directly -
# a permission added months from now, that nobody remembered to grant
# to owner, still can't accidentally lock the owner out of their own
# app. This is the one hardcoded string in the whole system, and it's
# hardcoded on purpose: the ceiling itself shouldn't be configurable
# away by a bug in some future migration.
OWNER_ROLE_NAME = 'owner'


def get_user_role_and_permissions(conn, user_id):
    """Returns (role_name, level, permission_keys) for a user.

    permission_keys is a set: the role's own bundled permissions, PLUS
    any user_permission_overrides row with granted=true, MINUS any
    override row with granted=false. Falls back to ('user', 0, set())
    if the user's role_id is somehow unset - a fresh signup should
    never silently get elevated access just because a migration step
    was missed, so the fallback is the least-privileged role, not the
    most.
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
    """The actual authorization check. Owner always passes - see
    OWNER_ROLE_NAME's docstring above for why that's structural rather
    than a maintained list of permission rows."""
    role_name, _level, perms = get_user_role_and_permissions(conn, user_id)
    if role_name == OWNER_ROLE_NAME:
        return True
    return permission_key in perms


def require_permission(permission_key):
    """Route decorator. Place it AFTER @jwt_required() (so
    get_jwt_identity() is already valid by the time this runs) and
    BEFORE @limiter.limit(...) - matching backend.py's existing
    decorator-ordering convention:

        @app.route(...)
        @jwt_required()
        @require_permission('categories.rename')
        @limiter.limit(...)
        def view():
            ...

    Opens its own short-lived connection for the permission check
    itself, released before the view function runs - the view gets its
    own connection for its own work exactly as before, this doesn't
    change that.
    """
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


# --- Read helpers used by /auth/me, /admin/users, /admin/roles, /admin/permissions ---

def list_all_permissions(conn):
    """Every permission key that exists, full stop - the canonical
    master list. CLI checklists and any future admin-panel UI read
    this instead of hardcoding the list anywhere else, so adding a
    permission is one schema.sql INSERT, not a hunt through the
    codebase for every place a list of permissions might be duplicated."""
    with conn.cursor() as cur:
        cur.execute("SELECT key, description FROM permissions ORDER BY key")
        return [{'key': row[0], 'description': row[1]} for row in cur.fetchall()]


def list_all_roles(conn):
    """Every role, with its level and the permission keys it bundles by
    default (NOT including any individual's per-user overrides - those
    are per-person, not per-role, see list_all_users)."""
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
    """Every user with their role name/level and their effective
    permission set (role bundle + overrides applied) - what
    listUsersAdmin.py shows, and what /admin/users returns."""
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


# The three roles seeded by schema.sql - protected from rename/delete
# via the API regardless of who's asking, even the owner. Not because
# owner shouldn't be trusted with it, but because there's no upside to
# letting the three foundational tiers be deleted or renamed through a
# JSON API call versus a deliberate direct migration - a mistaken
# DELETE here (wrong id typed, e.g.) would silently strip role_id out
# from under every user with that role and is not worth the convenience.
PROTECTED_ROLE_NAMES = {'owner', 'admin', 'user'}


def create_role(conn, name, level, permission_keys):
    """Creates a new custom role with the given permission bundle.
    Returns the new role dict. Raises ValueError on bad input (caller
    turns that into a 400)."""
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
    """Edits an existing role's level and/or permission bundle. Either
    argument can be omitted (None) to leave it unchanged. Refuses to
    touch the three protected roles' PERMISSION BUNDLES silently would
    be surprising given how central they are - but level changes are
    allowed even for them (bumping 'admin' up or down a notch is a
    reasonable thing to want; renaming or deleting it is not, see
    delete_role)."""
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
    """Replaces a role's ENTIRE permission bundle with permission_keys
    (not additive) - editing a role's permissions is meant to set the
    full new bundle, same convention as PATCH replacing a resource's
    field rather than appending to it. Unknown keys are silently
    ignored rather than erroring - a typo'd key just doesn't get
    attached to anything, which is safe (fails closed, not open)."""
    cur.execute("DELETE FROM role_permissions WHERE role_id = %s", (role_id,))
    if permission_keys:
        cur.execute(
            """INSERT INTO role_permissions (role_id, permission_id)
               SELECT %s, id FROM permissions WHERE key = ANY(%s)""",
            (role_id, list(permission_keys)),
        )


def delete_role(conn, role_id):
    """Deletes a custom role. Refuses to delete any of the three
    protected roles, and refuses to delete a role that still has users
    assigned to it (those users would otherwise be left with a NULL
    role_id, which get_user_role_and_permissions() would then treat as
    the least-privileged fallback - safe, but silently demoting people
    as a side effect of an unrelated cleanup action is exactly the kind
    of surprise this system is trying to avoid elsewhere, so it's
    refused outright here instead)."""
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
    """Returns {username, role, level} for a user, or None if not
    found. Lighter-weight than list_all_users() for routes that only
    need to check ONE target user's level for a hierarchy guard
    (delete/edit/impersonate below) - no point fetching everyone's
    full permission set just to read one row's level."""
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
    """Deletes a user account outright. Cascades to their
    transactions, uploaded_files, personal category_records, and any
    user_permission_overrides row for them, via each table's own
    ON DELETE CASCADE foreign key (see schema.sql) - there is no
    soft-delete or undo built into this. Returns the deleted username.
    Hierarchy and self-deletion guards are enforced in backend.py at
    the route level, same convention as assign_user_role - this
    function just performs the delete once that's already been
    decided."""
    with conn.cursor() as cur:
        cur.execute("SELECT username FROM users WHERE id = %s", (target_user_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError('User not found')
        username = row[0]
        cur.execute("DELETE FROM users WHERE id = %s", (target_user_id,))
    return username


def update_user_credentials(conn, target_user_id, new_username=None, new_password_hash=None):
    """Updates a user's username and/or password hash - at least one
    of the two must be given (the caller in backend.py enforces this
    before calling in, but it's checked again here too since this
    function might reasonably be called from elsewhere later). Raises
    ValueError if the user doesn't exist, or the new username is
    already taken by a DIFFERENT user (matching your own current
    username back is not an error - that's just "the username didn't
    actually change")."""
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
    """Sets a user's role_id by role name. Returns the updated user
    dict (see list_all_users' shape, one entry). Raises ValueError if
    the target user or role doesn't exist. Hierarchy guarding (whether
    the CALLER is allowed to hand out this particular role) is done in
    backend.py at the route level, not here - this function just
    performs the assignment once that's already been decided."""
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
    """Sets (or clears, if granted is None) one permission override for
    one user. granted=True grants an extra permission beyond their
    role; granted=False explicitly revokes one their role would
    otherwise give them; granted=None removes any existing override
    row entirely, returning that permission to "whatever the role alone
    says." Raises ValueError for an unknown permission key or user."""
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


# =====================================================================
# Admin-panel auth helpers (Task 27 — admin_users table is separate
# from the main users table; admin sessions use a different cookie).
# =====================================================================

def get_admin_role_and_permissions(conn, admin_user_id):
    """Like get_user_role_and_permissions but queries admin_users.
    Admin accounts have role-level permissions only (no per-user
    overrides — keep the admin permission model simple)."""
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
    if role_name == OWNER_ROLE_NAME:
        return True
    return permission_key in perms


_ADMIN_LOCKOUT_MINUTES = 15
_ADMIN_PERM_LOCK_SENTINEL = '9999-01-01 00:00:00+00'


def require_admin_auth(permission_key=None):
    """Decorator for admin panel routes.

    Reads and validates the admin_access_token cookie (issued only by
    /admin/auth/login — never by regular /auth/login), checks the
    admin_session claim, verifies the token is not revoked, then
    optionally checks a permission key against admin_users.

    Sets g.admin_user_id so the wrapped function can use it directly
    instead of calling get_jwt_identity().
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
                # Revocation check
                if jti:
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1 FROM revoked_tokens WHERE jti = %s", (jti,))
                        if cur.fetchone():
                            return jsonify({'error': 'Session revoked'}), 401

                # Permission check
                if permission_key and not admin_user_has_permission(conn, admin_user_id, permission_key):
                    return jsonify({'error': 'Not authorized'}), 403
            finally:
                release_connection(conn)

            g.admin_user_id = admin_user_id
            g.admin_token_jti = jti

            # HMAC verification — every authenticated request must be signed
            ok, reason = verify_hmac_request(request, str(admin_user_id), jti or '')
            if not ok:
                return jsonify({'error': f'HMAC verification failed: {reason}'}), 401

            return fn(*args, **kwargs)
        return wrapper
    return decorator

    return next(u for u in list_all_users(conn) if u['id'] == target_user_id)


def require_hmac(fn):
    """Decorator for regular JWT-protected routes (@jwt_required routes).
    Must be applied AFTER @jwt_required so get_jwt_identity() and get_jwt()
    are available. Verifies the HMAC signature on the request."""
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
