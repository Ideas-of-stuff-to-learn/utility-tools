"""
Canonical permission → level-point mapping.
Mirrors admin/src/utils/permissionWeights.js — keep in sync.
compute_role_level() is the single source of truth for derived role levels.
"""

PERMISSION_WEIGHTS = {
    'categories.create':             2,
    'categories.rename':             3,
    'categories.recolor':            4,
    'categories.set_default_color':  5,
    'categories.reorder':            6,
    'categories.combine':            7,
    'categories.delete':             9,
    'users.view':                   11,
    'roles.view':                   13,
    'audit.view':                   15,
    'users.assign_role':            17,
    'users.edit':                   19,
    'users.manage_permissions':     23,
    'roles.manage':                 25,
    'users.create':                 27,
    'users.delete':                 31,
    'users.impersonate':            37,
    'email.bypass_ratelimit':       29,
}


def compute_role_level(permission_keys):
    """Return a clamped 1-99 level derived purely from permission weights."""
    if not permission_keys:
        return 1
    total = sum(PERMISSION_WEIGHTS.get(k, 0) for k in permission_keys)
    return max(1, min(99, total))
