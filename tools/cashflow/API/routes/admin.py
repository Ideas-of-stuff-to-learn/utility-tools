"""
routes/admin.py

Everything that manages OTHER people's roles/permissions/accounts, plus
impersonation and its audit log/token revocation. Each endpoint is
gated by its own specific permission key via require_permission() (see
permissions.py) - there is no single "is_admin" shortcut anywhere here,
same convention as routes/categories.py.
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from datetime import timezone

from flask import request, jsonify, g
from flask_jwt_extended import create_access_token, decode_token
import bcrypt

from extensions import app, limiter, IMPERSONATION_TOKEN_EXPIRES
from rate_limits import RL_READ_ADMIN, RL_CATEGORY_WRITE, RL_ADMIN_SENSITIVE, RL_ADMIN_UNLOCK, RL_ADMIN_USER_TRANSACTIONS
from database import get_connection, release_connection
from permissions import (
    require_admin_auth, get_admin_role_and_permissions,
    list_all_permissions, list_all_roles, list_all_users,
    get_role_by_name, create_role, update_role, delete_role,
    assign_user_role, set_user_permission_override,
    get_user_level, delete_user, update_user_credentials,
)
from email_service import send_email
from permission_weights import compute_role_level
from backendLocalConfig import ADMIN_LEVEL_OVERRIDE_MIN, ADMIN_AUDIT_MIN_LEVEL
from audit import write_audit as _write_audit

_CLEANUP_SECRET = os.environ.get('CLEANUP_SECRET', '')

NEEDS_MANUAL_REVIEW = 'NEEDS_MANUAL_REVIEW'


def _get_owner_email(conn):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT u.email FROM users u
               JOIN roles r ON u.role_id = r.id
               WHERE r.name = 'owner' LIMIT 1"""
        )
        row = cur.fetchone()
    return row[0] if row else None


def _get_caller_email(conn, admin_user_id):
    """Returns the email of an admin_users account (may be NULL if not set)."""
    with conn.cursor() as cur:
        cur.execute("SELECT username FROM admin_users WHERE id = %s", (admin_user_id,))
        row = cur.fetchone()
    # admin_users has no email column yet; fall back to username for notifications
    return row[0] if row else None


def _send_deletion_scheduled_email(actor_email, owner_email, item_type, item_name, scheduled_at):
    if not actor_email:
        return
    cancel_url = (
        'https://ideas-of-stuff-to-learn.github.io/utility-tools/admin/#/general/roles'
        if item_type == 'role'
        else 'https://ideas-of-stuff-to-learn.github.io/utility-tools/admin/#/cashflow/categories'
    )
    subject = f'[utility-tools] Deletion scheduled: {item_type} "{item_name}"'
    html = f"""
<p>Hi,</p>
<p>A deletion has been scheduled for the <strong>{item_type}</strong> named <strong>{item_name}</strong>.</p>
<p>It will be permanently deleted <strong>48 hours</strong> from now (around {scheduled_at.strftime('%Y-%m-%d %H:%M UTC')}).</p>
<p>If you want to cancel this, visit the admin panel before then:</p>
<p><a href="{cancel_url}">{cancel_url}</a></p>
<p>You will receive a confirmation email once the deletion is permanent.</p>
"""
    try:
        send_email(actor_email, subject, html, cc_address=owner_email)
    except Exception as e:
        app.logger.warning(f'Deletion-scheduled email failed: {e}')


def _send_deletion_cancelled_email(actor_email, owner_email, item_type, item_name):
    if not actor_email:
        return
    subject = f'[utility-tools] Deletion cancelled: {item_type} "{item_name}"'
    html = f"""
<p>Hi,</p>
<p>The scheduled deletion of the <strong>{item_type}</strong> named <strong>{item_name}</strong> has been <strong>cancelled</strong>.</p>
<p>No further action is needed — the {item_type} remains active.</p>
"""
    try:
        send_email(actor_email, subject, html, cc_address=owner_email)
    except Exception as e:
        app.logger.warning(f'Deletion-cancelled email failed: {e}')


def _send_deletion_confirmed_email(actor_email, owner_email, item_type, item_name):
    if not actor_email:
        return
    subject = f'[utility-tools] Permanently deleted: {item_type} "{item_name}"'
    html = f"""
<p>Hi,</p>
<p>The <strong>{item_type}</strong> named <strong>{item_name}</strong> has been permanently deleted.</p>
<p>This action cannot be undone.</p>
"""
    try:
        send_email(actor_email, subject, html, cc_address=owner_email)
    except Exception as e:
        app.logger.warning(f'Deletion-confirmed email failed: {e}')


@app.route('/admin/permissions', methods=['GET'])
@require_admin_auth('roles.view')
@limiter.limit(RL_READ_ADMIN)
def admin_list_permissions():
    """The master list of every permission key that exists - what
    CLI/admin-panel checklists build their options from."""
    conn = get_connection()
    try:
        return jsonify({'permissions': list_all_permissions(conn)}), 200
    except Exception as e:
        app.logger.error(f'Fetching permissions failed: {e}')
        return jsonify({'error': 'Failed to fetch permissions'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/roles', methods=['GET'])
@require_admin_auth('roles.view')
@limiter.limit(RL_READ_ADMIN)
def admin_list_roles():
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        roles = list_all_roles(conn)
        if caller_role != 'owner':
            roles = [r for r in roles if r['level'] < caller_level]
        return jsonify({'roles': roles}), 200
    except Exception as e:
        app.logger.error(f'Fetching roles failed: {e}')
        return jsonify({'error': 'Failed to fetch roles'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/roles', methods=['POST'])
@require_admin_auth('roles.manage')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_create_role():
    """Creates a new custom role. The caller's own level acts as a
    ceiling: you cannot create a role at or above your own level (an
    owner has no ceiling; a level-50 admin with roles.manage could at
    most create something at level 49 or below) - otherwise a single
    permission grant (roles.manage) would let someone mint a role as
    powerful as themselves or higher, which defeats the point of levels
    existing at all."""
    data = request.get_json() or {}
    name = data.get('name')
    level = data.get('level')
    permission_keys = data.get('permissions') or []

    if level is None or not isinstance(level, int):
        return jsonify({'error': 'level (integer) is required'}), 400
    if not isinstance(permission_keys, list):
        return jsonify({'error': 'permissions must be a list of keys'}), 400

    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        computed_level = compute_role_level(permission_keys)
        can_override = caller_role == 'owner' or caller_level >= ADMIN_LEVEL_OVERRIDE_MIN
        if can_override and level is not None:
            # Senior admin provided a manual override — validate it
            if level >= caller_level:
                return jsonify({'error': f'Cannot create a role at or above your own level ({caller_level})'}), 403
        else:
            # Level must equal the formula result
            if level != computed_level:
                return jsonify({'error': f'Level must equal the permission-derived value ({computed_level})'}), 403
            if computed_level >= caller_level:
                return jsonify({'error': f'Cannot create a role at or above your own level ({caller_level})'}), 403
            level = computed_level

        role = create_role(conn, name, level, permission_keys)
        _write_audit(conn, current_user, 'roles.create', 'role', role.get('id'), {'name': name, 'level': level, 'permissions': permission_keys})
        conn.commit()
        return jsonify({'role': role}), 201
    except ValueError as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Role creation failed: {e}')
        return jsonify({'error': 'Role creation failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/roles/<int:role_id>', methods=['PATCH'])
@require_admin_auth('roles.manage')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_update_role(role_id):
    """Edits a role's level and/or permission bundle (permissions, if
    given, REPLACES the whole set - not additive, matching this app's
    existing PATCH convention elsewhere). Same level-ceiling guard as
    creation: a non-owner can't push a role's level to or above their
    own."""
    data = request.get_json() or {}
    level = data.get('level')
    permission_keys = data.get('permissions')

    if permission_keys is not None and not isinstance(permission_keys, list):
        return jsonify({'error': 'permissions must be a list of keys'}), 400

    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        can_override = caller_role == 'owner' or caller_level >= ADMIN_LEVEL_OVERRIDE_MIN
        if permission_keys is not None:
            computed_level = compute_role_level(permission_keys)
            if can_override and level is not None:
                if not isinstance(level, int):
                    return jsonify({'error': 'level must be an integer'}), 400
                if level >= caller_level:
                    return jsonify({'error': f'Cannot set a role to your level or above ({caller_level})'}), 403
            else:
                if level is not None and level != computed_level:
                    return jsonify({'error': f'Level must equal the permission-derived value ({computed_level})'}), 403
                if computed_level >= caller_level:
                    return jsonify({'error': f'Cannot set a role to your level or above ({caller_level})'}), 403
                level = computed_level
        elif level is not None:
            if not isinstance(level, int):
                return jsonify({'error': 'level must be an integer'}), 400
            if not can_override:
                return jsonify({'error': 'Cannot change level without also submitting permissions'}), 403
            if level >= caller_level:
                return jsonify({'error': f'Cannot set a role to your level or above ({caller_level})'}), 403

        role = update_role(conn, role_id, level=level, permission_keys=permission_keys)
        _write_audit(conn, current_user, 'roles.edit', 'role', role_id, {'level': level, 'permissions': permission_keys})
        conn.commit()
        return jsonify({'role': role}), 200
    except ValueError as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Role update failed: {e}')
        return jsonify({'error': 'Role update failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/roles/<int:role_id>', methods=['DELETE'])
@require_admin_auth('roles.manage')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_delete_role(role_id):
    """Soft-delete: marks the role for deletion after a 48-hour grace period."""
    from datetime import datetime
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        from permissions import get_role_by_id
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        role = get_role_by_id(conn, role_id)
        if not role:
            return jsonify({'error': 'Role not found'}), 404
        if role['level'] >= caller_level:
            return jsonify({'error': f'Cannot delete a role at or above your own level ({caller_level})'}), 403
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users WHERE role_id = %s", (role_id,))
            if cur.fetchone()[0]:
                return jsonify({'error': 'Users still have this role — reassign them first'}), 400
            now = datetime.now(timezone.utc)
            actor_email = _get_caller_email(conn, current_user)
            cur.execute(
                "UPDATE roles SET pending_deletion_at = %s, pending_deletion_by_email = %s WHERE id = %s",
                (now, actor_email, role_id)
            )
        _write_audit(conn, current_user, 'roles.delete', 'role', role_id, {'name': role['name']})
        conn.commit()
        owner_email = _get_owner_email(conn)
        _send_deletion_scheduled_email(actor_email, owner_email, 'role', role['name'], now)
        return jsonify({
            'status': 'pending',
            'role_id': role_id,
            'role_name': role['name'],
            'pending_deletion_at': now.isoformat(),
        }), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Role soft-delete failed: {e}')
        return jsonify({'error': 'Role deletion failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/roles/<int:role_id>/cancel-delete', methods=['POST'])
@require_admin_auth('roles.manage')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_cancel_delete_role(role_id):
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        from permissions import get_role_by_id
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        role = get_role_by_id(conn, role_id)
        if not role:
            return jsonify({'error': 'Role not found'}), 404
        if role['level'] >= caller_level:
            return jsonify({'error': f'Cannot cancel deletion of a role at or above your own level ({caller_level})'}), 403
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, pending_deletion_by_email FROM roles WHERE id = %s",
                (role_id,)
            )
            existing = cur.fetchone()
            if not existing:
                conn.rollback()
                return jsonify({'error': 'Role not found'}), 404
            role_name, actor_email = existing
            cur.execute(
                "UPDATE roles SET pending_deletion_at = NULL, pending_deletion_by_email = NULL WHERE id = %s",
                (role_id,)
            )
        conn.commit()
        owner_email = _get_owner_email(conn)
        _send_deletion_cancelled_email(actor_email, owner_email, 'role', role_name)
        return jsonify({'status': 'ok', 'role_id': role_id, 'role_name': role_name}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Cancel role delete failed: {e}')
        return jsonify({'error': 'Cancel failed'}), 500
    finally:
        release_connection(conn)


@app.route('/internal/process-pending-deletions', methods=['POST'])
def process_pending_deletions():
    """Called daily by the GitHub Actions keep-alive workflow.
    Hard-deletes roles and categories whose 48-hour grace period has expired,
    then sends confirmation emails. Protected by CLEANUP_SECRET."""
    secret = request.headers.get('X-Cleanup-Secret', '')
    if not _CLEANUP_SECRET or secret != _CLEANUP_SECRET:
        return jsonify({'error': 'Unauthorized'}), 401

    from datetime import datetime
    conn = get_connection()
    deleted_roles = []
    deleted_categories = []
    try:
        owner_email = _get_owner_email(conn)
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, name, pending_deletion_by_email FROM roles
                   WHERE pending_deletion_at IS NOT NULL
                     AND pending_deletion_at < NOW() - INTERVAL '48 hours'"""
            )
            roles_to_delete = cur.fetchall()

        for role_id, role_name, actor_email in roles_to_delete:
            try:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM roles WHERE id = %s", (role_id,))
                conn.commit()
                deleted_roles.append(role_name)
                _send_deletion_confirmed_email(actor_email or owner_email, owner_email, 'role', role_name)
            except Exception as e:
                conn.rollback()
                app.logger.error(f'Hard-delete role {role_id} failed: {e}')

        with conn.cursor() as cur:
            cur.execute(
                """SELECT name, pending_deletion_by_email FROM categories
                   WHERE pending_deletion_at IS NOT NULL
                     AND pending_deletion_at < NOW() - INTERVAL '48 hours'"""
            )
            cats_to_delete = cur.fetchall()

        for cat_name, actor_email in cats_to_delete:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE category_records SET category = %s WHERE category = %s",
                        (NEEDS_MANUAL_REVIEW, cat_name)
                    )
                    cur.execute(
                        "UPDATE merchants SET category = %s WHERE category = %s",
                        (NEEDS_MANUAL_REVIEW, cat_name)
                    )
                    cur.execute(
                        "UPDATE transactions SET category = %s WHERE category = %s",
                        (NEEDS_MANUAL_REVIEW, cat_name)
                    )
                    cur.execute("DELETE FROM categories WHERE name = %s", (cat_name,))
                conn.commit()
                deleted_categories.append(cat_name)
                _send_deletion_confirmed_email(actor_email or owner_email, owner_email, 'category', cat_name)
            except Exception as e:
                conn.rollback()
                app.logger.error(f'Hard-delete category {cat_name} failed: {e}')

        # Hard-delete user accounts past 48-hour grace period and notify them
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, email, username FROM users
                   WHERE deleted_at IS NOT NULL
                     AND deleted_at < NOW() - INTERVAL '48 hours'"""
            )
            users_to_delete = cur.fetchall()

        deleted_users = []
        for user_id, user_email, username in users_to_delete:
            try:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
                conn.commit()
                deleted_users.append(username)
                if user_email:
                    try:
                        send_email(
                            user_email,
                            '[utility-tools] Your account has been permanently deleted',
                            f'<p>Hi {username},</p>'
                            f'<p>Your utility-tools account and all associated data have been permanently deleted as scheduled.</p>'
                            f'<p>If you did not request this, please contact the site owner.</p>',
                            cc_address=owner_email,
                        )
                    except Exception as email_err:
                        app.logger.warning(f'Deletion-confirmed email failed for user {user_id}: {email_err}')
            except Exception as e:
                conn.rollback()
                app.logger.error(f'Hard-delete user {user_id} failed: {e}')

        return jsonify({
            'status': 'ok',
            'deleted_roles': deleted_roles,
            'deleted_categories': deleted_categories,
            'deleted_users': deleted_users,
        }), 200
    except Exception as e:
        app.logger.error(f'process_pending_deletions failed: {e}')
        return jsonify({'error': str(e)}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users', methods=['GET'])
@require_admin_auth('users.view')
@limiter.limit(RL_READ_ADMIN)
def admin_list_users():
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        _caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        users = list_all_users(conn)
        users = [u for u in users if u['level'] < caller_level]
        return jsonify({'users': users}), 200
    except Exception as e:
        app.logger.error(f'Fetching users failed: {e}')
        return jsonify({'error': 'Failed to fetch users'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>/role', methods=['PATCH'])
@require_admin_auth('users.assign_role')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_assign_role(target_user_id):
    """Assigns a role to another user, by role name. Same level-ceiling
    guard as role creation/editing: a non-owner with users.assign_role
    can only hand out roles strictly BELOW their own level - otherwise
    a level-50 admin with this one permission could promote someone
    (including themselves, via a different account) to their own tier
    or higher, which would make "levels" meaningless. Only the owner is
    exempt from this ceiling, including being able to assign the owner
    role itself to someone else - that's a deliberate, high-trust
    action the owner is allowed to take, not something the system
    should second-guess.
    """
    data = request.get_json() or {}
    role_name = data.get('role')
    if not role_name:
        return jsonify({'error': 'role is required'}), 400

    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        target_user = get_user_level(conn, target_user_id)
        if not target_user:
            return jsonify({'error': 'User not found'}), 404
        if target_user['level'] >= caller_level:
            return jsonify({'error': f'Cannot reassign a user at or above your own level ({caller_level})'}), 403
        target_role = get_role_by_name(conn, role_name)
        if not target_role:
            return jsonify({'error': f'Role "{role_name}" not found'}), 404
        if target_role['level'] >= caller_level:
            return jsonify({'error': f'Cannot assign a role at or above your own level ({caller_level})'}), 403

        user = assign_user_role(conn, target_user_id, role_name)
        _write_audit(conn, current_user, 'users.assign_role', 'user', target_user_id, {'role': role_name})
        conn.commit()
        return jsonify({'user': user}), 200
    except ValueError as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Role assignment failed: {e}')
        return jsonify({'error': 'Role assignment failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>/permissions', methods=['PATCH'])
@require_admin_auth('users.manage_permissions')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_set_permission_override(target_user_id):
    """Grants, revokes, or clears ONE individual permission override for
    ONE user - the fine-grained, per-person exception mechanism
    (schema.sql's user_permission_overrides). `granted` is a
    three-state field: true (extra grant), false (explicit revoke even
    if the role would give it), or null/omitted (clear any existing
    override, fall back to whatever the role alone says).
    """
    data = request.get_json() or {}
    permission_key = data.get('permission')
    granted = data.get('granted', None)

    if not permission_key:
        return jsonify({'error': 'permission is required'}), 400
    if granted is not None and not isinstance(granted, bool):
        return jsonify({'error': 'granted must be true, false, or omitted/null'}), 400

    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)

        # Level ceiling on the target user
        target = get_user_level(conn, target_user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if caller_role != 'owner' and target['level'] >= caller_level:
            return jsonify({'error': f'Cannot modify permissions for a user at or above your own level ({caller_level})'}), 403

        # Level ceiling on the permission itself — non-owners cannot grant a
        # permission that exclusively lives in roles at or above their own level.
        # (Revoking is always safe; only granting is restricted.)
        if granted is True and caller_role != 'owner':
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT MIN(r.level) FROM role_permissions rp
                       JOIN permissions p ON rp.permission_id = p.id
                       JOIN roles r ON rp.role_id = r.id
                       WHERE p.key = %s""",
                    (permission_key,),
                )
                row = cur.fetchone()
                min_perm_level = row[0] if row and row[0] is not None else 0
            if min_perm_level >= caller_level:
                return jsonify({'error': f'Cannot grant a permission that belongs to a role at or above your own level ({caller_level})'}), 403

        user = set_user_permission_override(conn, target_user_id, permission_key, granted)
        conn.commit()
        return jsonify({'user': user}), 200
    except ValueError as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Permission override failed: {e}')
        return jsonify({'error': 'Permission override failed - please try again'}), 500
    finally:
        release_connection(conn)


# --- Direct account-lifecycle actions (create/edit/delete/impersonate) ---
# Distinct from the role/permission-management endpoints above - these
# act on the ACCOUNT itself (does it exist, what are its credentials,
# can you borrow its session), not on what role/permissions it has.
# Added after the initial round of this system, per explicit request;
# bundled into the 'admin' role by default (see schema.sql) rather
# than owner-only, unlike users.view/assign_role/manage_permissions
# and roles.* above.
@app.route('/admin/users', methods=['POST'])
@require_admin_auth('users.create')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_create_user():
    """Creates a new user account directly, as an elevated action -
    distinct from the public, self-service /auth/signup (no permission
    check at all, rate-limited separately). Assigned the plain 'user'
    role at creation, same as any ordinary signup - use the "assign a
    role" action afterward if this account should start out elevated.
    Same validation rules as /auth/signup via the shared
    validate_username()/validate_password() helpers, so the two paths
    can never quietly drift into accepting different things."""
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    error = validate_username(username) or validate_password(password)
    if error:
        return jsonify({'error': error}), 400

    conn = get_connection()
    try:
        if username_exists(conn, username):
            return jsonify({'error': 'Username already taken'}), 409

        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12))
        new_id = create_user(conn, username, hashed.decode('utf-8'))
        user = next(u for u in list_all_users(conn) if u['id'] == new_id)
        return jsonify({'user': user}), 201
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Admin user creation failed: {e}')
        return jsonify({'error': 'User creation failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>', methods=['DELETE'])
@require_admin_auth('users.delete')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_delete_user(target_user_id):
    """Deletes a Cashflow user account. Admin panel actors are from a
    separate admin_users table so the self-delete check is not needed here.
    Same level-ceiling guard as role assignment.
    """
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        target = get_user_level(conn, target_user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if caller_role != 'owner' and target['level'] >= caller_level:
            return jsonify({'error': f'Cannot delete a user at or above your own level ({caller_level})'}), 403

        deleted_username = delete_user(conn, target_user_id)
        conn.commit()
        return jsonify({'status': 'ok', 'deleted_username': deleted_username}), 200
    except ValueError as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        app.logger.error(f'User deletion failed: {e}')
        return jsonify({'error': 'User deletion failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>/credentials', methods=['PATCH'])
@require_admin_auth('users.edit')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_edit_user_credentials(target_user_id):
    """Changes a Cashflow user's username and/or password."""
    data = request.get_json() or {}
    new_username = data.get('username')
    new_password = data.get('password')

    if new_username is None and new_password is None:
        return jsonify({'error': 'Provide username and/or password'}), 400

    if new_username is not None:
        new_username = new_username.strip()
        error = validate_username(new_username)
        if error:
            return jsonify({'error': error}), 400
    if new_password is not None:
        error = validate_password(new_password)
        if error:
            return jsonify({'error': error}), 400

    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        target = get_user_level(conn, target_user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if caller_role != 'owner' and target['level'] >= caller_level:
            return jsonify({'error': f'Cannot edit a user at or above your own level ({caller_level})'}), 403

        new_password_hash = None
        if new_password is not None:
            new_password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')

        user = update_user_credentials(
            conn, target_user_id,
            new_username=new_username, new_password_hash=new_password_hash,
        )
        conn.commit()
        return jsonify({'user': user}), 200
    except ValueError as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        app.logger.error(f'User credential update failed: {e}')
        return jsonify({'error': 'Update failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>/impersonate', methods=['POST'])
@require_admin_auth('users.impersonate')
@limiter.limit(RL_CATEGORY_WRITE)
def admin_impersonate_user(target_user_id):
    """Issues a short-lived access token for a Cashflow user account —
    logged to impersonation_log with actor_admin_user_id.
    """
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        target = get_user_level(conn, target_user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if caller_role != 'owner' and target['level'] >= caller_level:
            return jsonify({'error': f'Cannot impersonate a user at or above your own level ({caller_level})'}), 403

        token = create_access_token(
            identity=str(target_user_id),
            fresh=False,
            expires_delta=IMPERSONATION_TOKEN_EXPIRES,
        )
        jti = decode_token(token)["jti"]

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO impersonation_log (actor_admin_user_id, target_user_id, jti) VALUES (%s, %s, %s)",
                (current_user, target_user_id, jti),
            )
        _write_audit(conn, current_user, 'users.impersonate', 'user', target_user_id)
        conn.commit()

        return jsonify({
            'access_token': token,
            'username': target['username'],
            'jti': jti,
            'expires_in_seconds': int(IMPERSONATION_TOKEN_EXPIRES.total_seconds()),
        }), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Impersonation failed: {e}')
        return jsonify({'error': 'Impersonation failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/impersonation-log', methods=['GET'])
@require_admin_auth('audit.view')
@limiter.limit(RL_READ_ADMIN)
def admin_impersonation_log():
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        with conn.cursor() as cur:
            if caller_role == 'owner':
                cur.execute(
                    """SELECT il.id,
                              COALESCE(au.username, 'unknown') as actor,
                              ut.username, il.jti, il.created_at
                       FROM impersonation_log il
                       LEFT JOIN admin_users au ON il.actor_admin_user_id = au.id
                       LEFT JOIN users ua ON il.actor_user_id = ua.id
                       JOIN users ut ON il.target_user_id = ut.id
                       ORDER BY il.created_at DESC""",
                )
            else:
                cur.execute(
                    """SELECT il.id,
                              COALESCE(au.username, 'unknown') as actor,
                              ut.username, il.jti, il.created_at
                       FROM impersonation_log il
                       LEFT JOIN admin_users au ON il.actor_admin_user_id = au.id
                       LEFT JOIN users ua ON il.actor_user_id = ua.id
                       JOIN users ut ON il.target_user_id = ut.id
                       JOIN roles rt ON ut.role_id = rt.id
                       WHERE rt.level < %s
                       ORDER BY il.created_at DESC""",
                    (caller_level,),
                )
            rows = cur.fetchall()

        log = [
            {
                'id': row[0],
                'actor': row[1],
                'target': row[2],
                'jti': row[3],
                'created_at': row[4].isoformat(),
            }
            for row in rows
        ]
        return jsonify({'log': log}), 200
    except Exception as e:
        app.logger.error(f'Fetching impersonation log failed: {e}')
        return jsonify({'error': 'Failed to fetch impersonation log'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/tokens/revoke', methods=['POST'])
@require_admin_auth('users.impersonate')
@limiter.limit(RL_ADMIN_SENSITIVE)
def admin_revoke_token():
    """Revokes one specific token by its jti - lets an admin end an
    impersonation session early (wrong user picked, task finished
    ahead of the 15-minute window, etc.) rather than waiting out its
    expiry. Gated by 'users.impersonate' specifically, not a general
    token-management permission - this exists to let you clean up YOUR
    OWN impersonation actions, not as a general-purpose kill-switch for
    arbitrary sessions belonging to someone else.

    Silently succeeds even if the jti doesn't correspond to any
    currently-valid token (already expired, already revoked, never
    existed) - revoking something that's already effectively dead
    isn't an error, the end state ("this jti will not authenticate")
    is identical either way.
    """
    data = request.get_json() or {}
    jti = data.get('jti')
    if not jti:
        return jsonify({'error': 'jti is required'}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO revoked_tokens (jti) VALUES (%s) ON CONFLICT (jti) DO NOTHING",
                (jti,),
            )
        conn.commit()
        return jsonify({'status': 'ok', 'revoked_jti': jti}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Token revoke failed: {e}')
        return jsonify({'error': 'Revoke failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>/transactions', methods=['GET'])
@require_admin_auth('users.view')
@limiter.limit(RL_ADMIN_USER_TRANSACTIONS)
def admin_get_user_transactions(target_user_id):
    """Returns all transactions for any user, for admin inspection."""
    raw_offset = request.args.get('offset')
    raw_limit = request.args.get('limit')
    paginated = raw_limit is not None

    try:
        offset = max(0, int(raw_offset)) if raw_offset is not None else 0
        limit = min(max(1, int(raw_limit)), 2000) if raw_limit is not None else None
    except (TypeError, ValueError):
        return jsonify({'error': 'offset and limit must be integers'}), 400

    current_user = g.admin_user_id
    conn = get_connection()
    try:
        _caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        target = get_user_level(conn, target_user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if target['level'] >= caller_level:
            return jsonify({'error': f'Cannot view transactions for a user at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            if paginated:
                cur.execute(
                    "SELECT COUNT(*) FROM transactions WHERE user_id = %s",
                    (target_user_id,),
                )
                total = cur.fetchone()[0]
                cur.execute(
                    """SELECT id, txn_date, description, amount, category
                       FROM transactions WHERE user_id = %s
                       ORDER BY id LIMIT %s OFFSET %s""",
                    (target_user_id, limit, offset),
                )
            else:
                total = None
                cur.execute(
                    """SELECT id, txn_date, description, amount, category
                       FROM transactions WHERE user_id = %s ORDER BY id""",
                    (target_user_id,),
                )

            rows = cur.fetchall()

        transactions = [
            {'id': r[0], 'txn_date': r[1], 'description': r[2],
             'amount': float(r[3]), 'category': r[4]}
            for r in rows
        ]
        response = {'transactions': transactions}
        if total is not None:
            response['total'] = total
        return jsonify(response), 200
    except Exception as e:
        app.logger.error(f'Admin fetch transactions for user {target_user_id} failed: {e}')
        return jsonify({'error': 'Failed to fetch transactions'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/users/<int:target_user_id>/unlock', methods=['POST'])
@require_admin_auth('users.unlock')
@limiter.limit(RL_ADMIN_UNLOCK)
def admin_unlock_user(target_user_id):
    """Clears login lockout and email rate-limit state for a Cashflow user."""
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        _caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        target = get_user_level(conn, target_user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if target['level'] >= caller_level:
            return jsonify({'error': f'Cannot unlock a user at or above your own level ({caller_level})'}), 403

        with conn.cursor() as cur:
            cur.execute(
                """UPDATE users SET
                     failed_login_attempts  = 0,
                     login_locked_until     = NULL,
                     login_locked           = FALSE,
                     email_daily_count      = 0,
                     email_daily_count_date = NULL,
                     last_email_sent_at     = NULL
                   WHERE id = %s""",
                (target_user_id,),
            )
        conn.commit()
        app.logger.info(f'Admin {current_user} unlocked account for user {target_user_id}')
        return jsonify({'status': 'ok', 'unlocked_user_id': target_user_id}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Unlock failed for user {target_user_id}: {e}')
        return jsonify({'error': 'Unlock failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/audit', methods=['GET'])
@require_admin_auth()
@limiter.limit(RL_READ_ADMIN)
def admin_audit_log():
    """Global admin activity log. Gated by caller level >= ADMIN_AUDIT_MIN_LEVEL."""
    current_user = g.admin_user_id
    conn = get_connection()
    try:
        caller_role, caller_level, _perms = get_admin_role_and_permissions(conn, current_user)
        if caller_role != 'owner' and caller_level < ADMIN_AUDIT_MIN_LEVEL:
            return jsonify({'error': 'Insufficient level to view audit log'}), 403

        action_filter = request.args.get('action', '').strip()
        actor_filter  = request.args.get('actor', '').strip()
        limit         = min(int(request.args.get('limit', 200)), 500)

        where_clauses = []
        params = []
        if action_filter:
            where_clauses.append("aal.action = %s")
            params.append(action_filter)
        if actor_filter:
            where_clauses.append("au.username ILIKE %s")
            params.append(f'%{actor_filter}%')
        where_sql = ('WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''
        params.append(limit)

        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT aal.id, aal.created_at, au.username AS actor,
                           aal.action, aal.target_type, aal.target_id, aal.detail
                    FROM admin_audit_log aal
                    LEFT JOIN admin_users au ON aal.actor_admin_id = au.id
                    {where_sql}
                    ORDER BY aal.created_at DESC
                    LIMIT %s""",
                params,
            )
            rows = cur.fetchall()

        log = [
            {
                'id':          row[0],
                'created_at':  row[1].isoformat(),
                'actor':       row[2] or 'unknown',
                'action':      row[3],
                'target_type': row[4],
                'target_id':   row[5],
                'detail':      row[6],
            }
            for row in rows
        ]
        return jsonify({'log': log}), 200
    except Exception as e:
        app.logger.error(f'admin_audit_log failed: {e}')
        return jsonify({'error': 'Failed to fetch audit log'}), 500
    finally:
        release_connection(conn)


