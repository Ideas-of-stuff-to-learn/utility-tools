"""
routes/categories.py

Category CRUD, colour, combine/rename, and reorder - the admin-facing
category management endpoints. Every write here cascades to
category_records/merchants/transactions as needed and patches the
process-level in-memory caches (CategoryCache, the merchants cache) in
place afterward, rather than invalidating and paying for a reload.
"""
from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_CATEGORY_WRITE, RL_READ_CATEGORIES
from database import get_connection, release_connection
from cache import CategoryCache
from matching import patch_merchants_category_rename
from checkingName import NEEDS_MANUAL_REVIEW
from middleware.user_middleware import require_auth, require_permission, get_user_role_and_permissions
import re

@app.route('/categories', methods=['GET'])
@require_auth()
@limiter.limit(RL_READ_CATEGORIES)
def get_categories():
    """Returns every user-facing category, in display order, with its
    colour - the live replacement for the old static CATEGORY_ORDER/
    CATEGORY_COLORS import from checkingName.js. The MANUALLY CATEGORISE
    sentinel is deliberately not included here, same reasoning as
    load_categories() itself - it's a system state, not a real category.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name, color, default_color, pending_deletion_at FROM categories ORDER BY display_order"
            )
            rows = cur.fetchall()
            cur.execute("SELECT COUNT(*) + COALESCE(MAX(id), 0) FROM categories")
            version = cur.fetchone()[0]

        categories = [
            {
                'name': row[0], 'color': row[1], 'defaultColor': row[2],
                'pending_deletion_at': row[3].isoformat() if row[3] else None,
            }
            for row in rows
        ]
        return jsonify({'categories': categories, 'version': version}), 200
    except Exception as e:
        app.logger.error(f'Fetching categories failed: {e}')
        return jsonify({'error': 'Failed to fetch categories'}), 500
    finally:
        release_connection(conn)

@app.route('/categories', methods=['PATCH'])
@require_auth()
@limiter.limit(RL_CATEGORY_WRITE)
def update_category():
    """Renames a category and/or changes its colour.

    The category being changed (current_name) travels in the JSON body
    now, not the URL path - some category names contain a literal "/"
    (e.g. "Sports/Fitness"), and a URL-encoded slash (%2F) is handled
    specially by a lot of web infrastructure for security reasons
    (ambiguous-path attacks), which meant it could get rejected or
    mismatched before Flask's own routing ever got a chance to look at
    it - regardless of using <path:...> in the route. Request bodies
    have no such restriction on any character, so this sidesteps the
    problem entirely rather than continuing to fight framework/web
    server internals we don't have full visibility into.

    Renaming cascades everywhere the OLD name currently appears -
    category_records (both scopes), merchants, and every stored
    transaction - since this is safe regardless of any description's
    ambiguity status: it relabels a category string that already
    exists, it does not assert anything new about what a description
    means (unlike the resolved-vs-ambiguous backfill in /categorize/
    resolve, which genuinely does need that check).

    Recolouring only ever touches the categories table itself - colour
    is looked up by name at render time, never stored per-transaction,
    so there is nothing to cascade.
    """
    data = request.get_json() or {}
    category_name = data.get('current_name')
    new_name = data.get('new_name')
    new_color = data.get('color')

    if not category_name:
        return jsonify({'error': 'current_name is required'}), 400
    if not new_name and not new_color:
        return jsonify({'error': 'Provide new_name and/or color'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        # Renaming and recolouring are two distinct permission keys
        # (categories.rename / categories.recolor) - a request touching
        # BOTH in one call needs both, since granting one shouldn't
        # silently imply the other. This replaces what used to be a
        # single hardcoded username=='admin' check covering everything.
        with conn.cursor() as cur:
            _role, _level, perms = get_user_role_and_permissions(conn, current_user)
        is_owner = _role == 'owner'
        if new_name and not (is_owner or 'categories.rename' in perms):
            return jsonify({'error': 'Not authorized'}), 403
        if new_color and not (is_owner or 'categories.recolor' in perms):
            return jsonify({'error': 'Not authorized'}), 403
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM categories WHERE name = %s", (category_name,))
            if not cur.fetchone():
                return jsonify({'error': f'Category "{category_name}" not found'}), 404

            original_category_name = category_name
            renamed = bool(new_name and new_name != category_name)

            if renamed:
                cur.execute("SELECT 1 FROM categories WHERE name = %s", (new_name,))
                if cur.fetchone():
                    return jsonify({'error': f'Category "{new_name}" already exists'}), 409

                cur.execute("UPDATE categories SET name = %s WHERE name = %s", (new_name, category_name))
                cur.execute("UPDATE category_records SET category = %s WHERE category = %s", (new_name, category_name))
                cur.execute("UPDATE merchants SET category = %s WHERE category = %s", (new_name, category_name))
                cur.execute("UPDATE transactions SET category = %s WHERE category = %s", (new_name, category_name))
                category_name = new_name

            if new_color:
                cur.execute("UPDATE categories SET color = %s WHERE name = %s", (new_color, category_name))

        conn.commit()

        if renamed:
            # The UPDATEs above change category_records/merchants
            # directly in Postgres, bypassing CategoryCache entirely -
            # the process-level global caches (cache.py, categoriseAugDB.py)
            # have no way to know this happened on their own, and would
            # otherwise keep serving the OLD category name from memory
            # for the rest of this process's lifetime. Patch both caches
            # in place with the same rename, cheaply, instead of
            # discarding them and paying for a full reload on the next
            # request.
            CategoryCache.patch_global_category_rename(original_category_name, new_name)
            patch_merchants_category_rename(original_category_name, new_name)

        return jsonify({'status': 'ok', 'name': category_name, 'color': new_color}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Category update failed: {e}')
        return jsonify({'error': 'Category update failed - please try again'}), 500
    finally:
        release_connection(conn)

@app.route('/categories/combine', methods=['PATCH'])
@require_auth()
@require_permission('categories.combine')
@limiter.limit(RL_CATEGORY_WRITE)
def combine_categories():
    """Merges 2+ existing categories into one, under new_name.

    new_name can be a brand new name, or it can match one of the
    categories already being merged (e.g. combining "Travel" and
    "Trips" into "Travel" - keeping that name rather than picking
    something new). It canNOT match some OTHER, unrelated category
    that isn't part of this merge - that would silently fold this
    merge's data into an unrelated category no one asked to touch.

    Implementation-wise this reuses one EXISTING row from `names`
    (whichever one ends up being new_name, or the first one given if
    new_name is genuinely new - renamed in place) rather than
    inserting a fresh categories row, so there's no need to invent a
    display_order or colour for a brand new row: the survivor just
    keeps whatever it already had. Every other selected category's
    data is folded into that survivor, then its own categories row is
    deleted.

    Same cascade as a rename (category_records, merchants,
    transactions), just done once per category being folded in rather
    than once overall. Admin-only, same reasoning as rename/recolour -
    this is global, shared structure.
    """
    data = request.get_json() or {}
    names = data.get('names')
    new_name = (data.get('new_name') or '').strip()

    if not names or not isinstance(names, list) or len(names) < 2:
        return jsonify({'error': 'names must be a list of at least 2 categories'}), 400
    if len(set(names)) != len(names):
        return jsonify({'error': 'names contains duplicates'}), 400
    if not new_name:
        return jsonify({'error': 'new_name is required'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM categories WHERE name = ANY(%s)", (names,))
            found = {r[0] for r in cur.fetchall()}
            missing = [n for n in names if n not in found]
            if missing:
                return jsonify({'error': f'Categor{"y" if len(missing) == 1 else "ies"} not found: {", ".join(missing)}'}), 404

            # new_name is only a conflict if it belongs to some category
            # OUTSIDE this merge - matching one of the categories already
            # being merged is fine (that's the "keep this existing name"
            # case), that's just not treated as a NEW conflicting row.
            cur.execute("SELECT 1 FROM categories WHERE name = %s", (new_name,))
            new_name_exists_elsewhere = bool(cur.fetchone()) and new_name not in names
            if new_name_exists_elsewhere:
                return jsonify({'error': f'Category "{new_name}" already exists and is not part of this merge'}), 409

            # Pick which existing row survives:
            # - if new_name matches one of the selected categories,
            #   THAT row survives unchanged (no rename needed) - the
            #   "keep this existing name" case.
            # - otherwise new_name is genuinely new, so the FIRST
            #   selected category's row survives, renamed to new_name.
            new_name_is_new = new_name not in names
            base_name = names[0] if new_name_is_new else new_name
            others = [n for n in names if n != base_name]

            if new_name_is_new:
                cur.execute("UPDATE categories SET name = %s WHERE name = %s", (new_name, base_name))
                # base_name's own data still says the OLD name string
                # everywhere else (categories.name isn't a foreign key
                # anywhere) - cascade it the same as a plain rename.
                cur.execute("UPDATE category_records SET category = %s WHERE category = %s", (new_name, base_name))
                cur.execute("UPDATE merchants SET category = %s WHERE category = %s", (new_name, base_name))
                cur.execute("UPDATE transactions SET category = %s WHERE category = %s", (new_name, base_name))

            for old_name in others:
                cur.execute("UPDATE category_records SET category = %s WHERE category = %s", (new_name, old_name))
                cur.execute("UPDATE merchants SET category = %s WHERE category = %s", (new_name, old_name))
                cur.execute("UPDATE transactions SET category = %s WHERE category = %s", (new_name, old_name))
                cur.execute("DELETE FROM categories WHERE name = %s", (old_name,))

        conn.commit()

        # Same in-memory cache patching as a plain rename, just once
        # per folded-in name instead of once overall.
        renamed_away = [n for n in names if n != new_name]
        for old_name in renamed_away:
            CategoryCache.patch_global_category_rename(old_name, new_name)
            patch_merchants_category_rename(old_name, new_name)

        return jsonify({'status': 'ok', 'name': new_name, 'merged_from': renamed_away}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Category combine failed: {e}')
        return jsonify({'error': 'Category combine failed - please try again'}), 500
    finally:
        release_connection(conn)

@app.route('/categories', methods=['DELETE'])
@require_auth()
@require_permission('categories.delete')
@limiter.limit(RL_CATEGORY_WRITE)
def delete_category():
    """Soft-delete: marks the category for deletion after a 48-hour grace period.
    The actual hard-delete (with transaction reassignment) happens via the
    daily /internal/process-pending-deletions job."""
    from datetime import datetime, timezone
    from flask_jwt_extended import get_jwt_identity
    from routes.admin import _get_owner_email, _get_caller_email, _send_deletion_scheduled_email
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()

    if not name:
        return jsonify({'error': 'name is required'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        actor_email = _get_caller_email(conn, current_user)
        with conn.cursor() as cur:
            now = datetime.now(timezone.utc)
            cur.execute(
                "UPDATE categories SET pending_deletion_at = %s, pending_deletion_by_email = %s WHERE name = %s RETURNING name",
                (now, actor_email, name)
            )
            if not cur.fetchone():
                conn.rollback()
                return jsonify({'error': f'Category "{name}" not found'}), 404
        conn.commit()
        owner_email = _get_owner_email(conn)
        _send_deletion_scheduled_email(actor_email, owner_email, 'category', name, now)
        return jsonify({
            'status': 'pending',
            'name': name,
            'pending_deletion_at': now.isoformat(),
        }), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Category soft-delete failed: {e}')
        return jsonify({'error': 'Category deletion failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categories/cancel-delete', methods=['POST'])
@require_auth()
@require_permission('categories.delete')
@limiter.limit(RL_CATEGORY_WRITE)
def cancel_delete_category():
    from routes.admin import _get_owner_email, _get_caller_email, _send_deletion_cancelled_email
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pending_deletion_by_email FROM categories WHERE name = %s",
                (name,)
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return jsonify({'error': f'Category "{name}" not found'}), 404
            actor_email = row[0]
            cur.execute(
                "UPDATE categories SET pending_deletion_at = NULL, pending_deletion_by_email = NULL WHERE name = %s",
                (name,)
            )
        conn.commit()
        owner_email = _get_owner_email(conn)
        _send_deletion_cancelled_email(actor_email, owner_email, 'category', name)
        return jsonify({'status': 'ok', 'name': name}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Cancel category delete failed: {e}')
        return jsonify({'error': 'Cancel failed'}), 500
    finally:
        release_connection(conn)

@app.route('/categories', methods=['POST'])
@require_auth()
@require_permission('categories.create')
@limiter.limit(RL_CATEGORY_WRITE)
def create_category():
    """Adds a brand new category - admin-only, same reasoning as
    rename/combine/recolour: this is global, shared structure.

    Unlike rename/combine, this needs no cascade anywhere: nothing
    references this name yet by definition, so there's nothing else
    to update. load_categories() (categoriseAugDB.py) re-queries the
    categories table fresh on every /categorize/llm call with no
    caching of its own, so a newly added category is available to the
    LLM as a valid target immediately, on the very next categorisation
    request - no cache to invalidate, no restart needed.

    display_order is auto-assigned as one past the current max, so new
    categories always land at the end of the list rather than needing
    the caller to know/guess a free slot. color is required; default_color
    is seeded identical to it, same convention as the schema's initial
    seed data - "reset to default" will revert to whatever color was
    given here until changed via the separate default-color admin tool.
    """
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    color = (data.get('color') or '').strip()

    if not name:
        return jsonify({'error': 'name is required'}), 400
    if not color:
        return jsonify({'error': 'color is required'}), 400
    if not re.match(r'^#[0-9A-Fa-f]{6}$', color):
        return jsonify({'error': 'color must be a hex string like #3D8B5F'}), 400
    if name == NEEDS_MANUAL_REVIEW:
        return jsonify({'error': f'"{name}" is a reserved system value, not a real category'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM categories WHERE name = %s", (name,))
            if cur.fetchone():
                return jsonify({'error': f'Category "{name}" already exists'}), 409

            cur.execute("SELECT COALESCE(MAX(display_order), 0) FROM categories")
            next_order = cur.fetchone()[0] + 1

            cur.execute(
                "INSERT INTO categories (name, display_order, color, default_color) VALUES (%s, %s, %s, %s)",
                (name, next_order, color, color),
            )

        conn.commit()
        return jsonify({'status': 'ok', 'name': name, 'color': color, 'display_order': next_order}), 201
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Category creation failed: {e}')
        return jsonify({'error': 'Category creation failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categories/order', methods=['PATCH'])
@require_auth()
@require_permission('categories.reorder')
@limiter.limit(RL_CATEGORY_WRITE)
def reorder_categories():
    """Sets the global display_order for all categories. `names` must be
    a list containing every existing category name exactly once - no
    extras, no omissions. The position in the list becomes the new
    display_order (index 0 = order 1, the bottom segment of the stack).
    Affects every user immediately since GET /categories already returns
    rows ORDER BY display_order.

    Validated strictly before any writes: the request is rejected as a
    whole if the provided list doesn't exactly match the current set of
    categories - this prevents a partial reorder leaving display_order
    values in an inconsistent or colliding state.
    """
    data = request.get_json() or {}
    names = data.get('names')
    if not names or not isinstance(names, list):
        return jsonify({'error': 'names (list of category names) is required'}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM categories ORDER BY display_order")
            existing = [row[0] for row in cur.fetchall()]

        existing_set = set(existing)
        incoming_set = set(names)

        if len(names) != len(set(names)):
            return jsonify({'error': 'names contains duplicates'}), 400
        missing = existing_set - incoming_set
        extra = incoming_set - existing_set
        if missing or extra:
            parts = []
            if missing:
                parts.append(f'missing: {", ".join(sorted(missing))}')
            if extra:
                parts.append(f'unknown: {", ".join(sorted(extra))}')
            return jsonify({'error': f'names must include every existing category exactly once — {"; ".join(parts)}'}), 400

        with conn.cursor() as cur:
            for i, name in enumerate(names, start=1):
                cur.execute(
                    "UPDATE categories SET display_order = %s WHERE name = %s",
                    (i, name),
                )
        conn.commit()

        with conn.cursor() as cur:
            cur.execute("SELECT name, color, default_color FROM categories ORDER BY display_order")
            categories = [
                {'name': row[0], 'color': row[1], 'defaultColor': row[2]}
                for row in cur.fetchall()
            ]
        return jsonify({'categories': categories}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Reorder categories failed: {e}')
        return jsonify({'error': 'Reorder failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categories/reset-defaults', methods=['POST'])
@require_auth()
@require_permission('categories.recolor')
@limiter.limit(RL_CATEGORY_WRITE)
def reset_category_defaults():
    """Resets color back to default_color, scoped to whichever category
    names are given - same scoping convention as update_category's
    recolour action (applies to a selected set, not the whole table
    unconditionally), so this button lives inside the same
    select-some-categories flow the picker already uses.

    Admin-only, same reasoning as recolouring itself: this is global,
    shared structure, not a personal action.
    """
    data = request.get_json() or {}
    names = data.get('names')

    if not names or not isinstance(names, list):
        return jsonify({'error': 'names must be a non-empty list'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE categories SET color = default_color WHERE name = ANY(%s)",
                (names,),
            )

        conn.commit()

        with conn.cursor() as cur:
            cur.execute("SELECT name, color, default_color FROM categories ORDER BY display_order")
            rows = cur.fetchall()
        categories = [{'name': row[0], 'color': row[1], 'defaultColor': row[2]} for row in rows]
        return jsonify({'categories': categories}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Reset category defaults failed: {e}')
        return jsonify({'error': 'Reset failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categories/default-color', methods=['PATCH'])
@require_auth()
@require_permission('categories.set_default_color')
@limiter.limit(RL_CATEGORY_WRITE)
def update_default_color():
    """Admin-only: redefines what a category's DEFAULT colour is - i.e.
    what "reset to defaults" resets TO - as distinct from update_category,
    which changes the CURRENT live colour. current_name travels in the
    body, same convention as update_category, for the same reason (some
    category names contain characters that don't play well as URL path
    segments).
    """
    data = request.get_json() or {}
    category_name = data.get('current_name')
    new_default_color = data.get('default_color')

    if not category_name or not new_default_color:
        return jsonify({'error': 'current_name and default_color are required'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM categories WHERE name = %s", (category_name,))
            if not cur.fetchone():
                return jsonify({'error': f'Category "{category_name}" not found'}), 404

            cur.execute(
                "UPDATE categories SET default_color = %s WHERE name = %s",
                (new_default_color, category_name),
            )

        conn.commit()
        return jsonify({'status': 'ok', 'name': category_name, 'default_color': new_default_color}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Default colour update failed: {e}')
        return jsonify({'error': 'Default colour update failed - please try again'}), 500
    finally:
        release_connection(conn)
