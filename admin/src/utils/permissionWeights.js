/**
 * Canonical permission → level-point mapping.
 * Mirrors tools/cashflow/API/permission_weights.py — keep in sync.
 */
export const PERMISSION_WEIGHTS = {
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
};

/** Return a clamped 1-99 level derived purely from permission weights. */
export function computeRoleLevel(permissionKeys) {
    if (!permissionKeys || permissionKeys.length === 0) return 1;
    const total = permissionKeys.reduce((sum, k) => sum + (PERMISSION_WEIGHTS[k] ?? 0), 0);
    return Math.max(1, Math.min(99, total));
}
