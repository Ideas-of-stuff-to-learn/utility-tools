"""
category_prefs.py

Category names are also stored INSIDE users.preferences (a JSON column):
  stackOrder - the "remember my order" custom chart order (array of names)
  mrPicks    - pending manual-review picks (array of objects with a "category")

Renaming, combining or deleting a category used to update the four tables that
store names (categories, category_records, merchants, transactions) but not
these, so a renamed category silently vanished from any custom chart order.
Every endpoint that changes a category's identity calls apply_to_preferences()
inside its own transaction, so tables and preferences change atomically.
"""
import json


def transform_stack_order(order, mapping):
    """Rename/remove names in a saved stack order, keeping position and dropping
    duplicates (combining two categories can otherwise leave the same name twice)."""
    out, seen = [], set()
    for item in order:
        if isinstance(item, str) and item in mapping:
            item = mapping[item]
            if item is None:
                continue
        key = item if isinstance(item, str) else json.dumps(item, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def transform_mr_picks(picks, mapping):
    """Rename the category on pending manual-review picks; drop picks whose
    category was deleted (there is nothing valid left to resolve them to)."""
    out = []
    for pick in picks:
        if isinstance(pick, dict) and pick.get('category') in mapping:
            new = mapping[pick['category']]
            if new is None:
                continue
            pick = {**pick, 'category': new}
        out.append(pick)
    return out


_AFFECTED_USERS_SQL = """
    SELECT id, preferences FROM users
    WHERE (jsonb_typeof(preferences -> 'stackOrder') = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(preferences -> 'stackOrder') AS n(v)
                       WHERE n.v = ANY(%s)))
       OR (jsonb_typeof(preferences -> 'mrPicks') = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(preferences -> 'mrPicks') AS p(v)
                       WHERE p.v ->> 'category' = ANY(%s)))
    FOR UPDATE
"""


def apply_to_preferences(cur, mapping):
    """mapping: {old_name: new_name}, or {old_name: None} to remove a name.
    Rewrites stackOrder / mrPicks for every affected user using the caller's
    cursor (so it commits or rolls back with the category change). Rows are
    locked FOR UPDATE, so a user saving settings at the same moment waits for
    the commit instead of being overwritten. Returns the number of users changed."""
    names = list(mapping)
    if not names:
        return 0
    cur.execute(_AFFECTED_USERS_SQL, (names, names))
    changed = 0
    for user_id, prefs in cur.fetchall():
        patch = {}
        order = prefs.get('stackOrder')
        if isinstance(order, list):
            new_order = transform_stack_order(order, mapping)
            if new_order != order:
                patch['stackOrder'] = new_order
        picks = prefs.get('mrPicks')
        if isinstance(picks, list):
            new_picks = transform_mr_picks(picks, mapping)
            if new_picks != picks:
                patch['mrPicks'] = new_picks
        if patch:
            cur.execute(
                "UPDATE users SET preferences = COALESCE(preferences, '{}'::jsonb) || %s::jsonb WHERE id = %s",
                (json.dumps(patch), user_id),
            )
            changed += 1
    return changed
