const BASE_URL = import.meta.env.PROD
    ? 'https://cashflow2-0.onrender.com'
    : `http://${import.meta.env.VITE_LOCAL_IP || 'localhost'}:${import.meta.env.VITE_BACKEND_PORT || '5050'}`;

const DEFAULT_TIMEOUT_MS = 110000;

let csrfAdminAccess    = null;
let csrfAdminRefresh   = null;
let hmacSigningSecret  = null;  // hex string, held in JS memory only

// ── IDB key — held in JS memory only, never persisted ───────────────────────
let _idbCryptoKey = null;
let _idbAdminUserId = null;

export function getIdbKey()        { return _idbCryptoKey; }
export function getIdbAdminUserId() { return _idbAdminUserId; }

async function _setIdbKey(base64Dek, adminUserId) {
    try {
        const { importKey } = await import('./idb/crypto.js');
        _idbCryptoKey    = await importKey(base64Dek);
        _idbAdminUserId  = adminUserId;
    } catch (e) {
        console.warn('[AdminIDB] key import failed:', e.message);
    }
}

async function computeHmacHeaders(method, path) {
    if (!hmacSigningSecret) return {};
    const ts = Math.floor(Date.now() / 1000);
    const msg = new TextEncoder().encode(`${ts}:${method.toUpperCase()}:${path}`);
    const keyBytes = new Uint8Array(hmacSigningSecret.match(/.{2}/g).map(b => parseInt(b, 16)));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, msg);
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { 'X-HMAC-Sig': hex, 'X-HMAC-TS': String(ts) };
}

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError') {
            const e = new Error(`Request timed out after ${timeoutMs}ms`);
            e.isTimeout = true;
            throw e;
        }
        throw err;
    } finally {
        clearTimeout(id);
    }
}

async function parseJson(response, fallback) {
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
        if (response.status === 502 || response.status === 503)
            throw new Error('Server is starting up — please try again in a few seconds.');
        throw new Error(`Unexpected server response (status ${response.status})`);
    }
    if (!response.ok) throw new Error(data.error || data.msg || fallback);
    return data;
}

let refreshPromise = null;

async function tryRefresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        try {
            const r = await fetchWithTimeout(`${BASE_URL}/admin/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-Admin-CSRF-TOKEN': csrfAdminRefresh },
            }, 70000);
            if (r.ok) {
                const d = await r.json();
                csrfAdminAccess  = d.csrf_admin_access;
                csrfAdminRefresh = d.csrf_admin_refresh;
                if (d.hmac_signing_secret) hmacSigningSecret = d.hmac_signing_secret;
            } else {
                window.dispatchEvent(new CustomEvent('auth:session-expired'));
            }
            return r.ok;
        } finally {
            refreshPromise = null;
        }
    })();
    return refreshPromise;
}

async function authFetch(url, options = {}) {
    const method = options.method || 'GET';
    const path = new URL(url, 'http://x').pathname;
    const hmacHeaders = await computeHmacHeaders(method, path);
    let r = await fetchWithTimeout(url, {
        ...options,
        credentials: 'include',
        headers: { ...options.headers, 'X-CSRF-TOKEN': csrfAdminAccess, ...hmacHeaders },
    });
    if (r.status === 401) {
        const ok = await tryRefresh();
        if (!ok) throw new Error('Not logged in');
        const hmacHeaders2 = await computeHmacHeaders(method, path);
        r = await fetchWithTimeout(url, {
            ...options,
            credentials: 'include',
            headers: { ...options.headers, 'X-CSRF-TOKEN': csrfAdminAccess, ...hmacHeaders2 },
        });
    }
    return r;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

// Step 1: verify username + password → returns temp_token + step
export async function loginStep1(username, password) {
    const r = await fetchWithTimeout(`${BASE_URL}/admin/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    }, 70000);
    return parseJson(r, 'Login failed');
}

// Step 2: verify TOTP code → issues session cookies
export async function loginStep2(tempToken, totpCode) {
    const r = await fetchWithTimeout(`${BASE_URL}/admin/auth/verify-totp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp_token: tempToken, totp_code: totpCode }),
    }, 70000);
    const d = await parseJson(r, 'Verification failed');
    csrfAdminAccess  = d.csrf_admin_access;
    csrfAdminRefresh = d.csrf_admin_refresh;
    if (d.hmac_signing_secret) hmacSigningSecret = d.hmac_signing_secret;
    if (d.idb_key && d.admin_user_id != null) await _setIdbKey(d.idb_key, d.admin_user_id);
    return d;
}

export async function logout() {
    await fetch(`${BASE_URL}/admin/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrfAdminAccess },
    }).catch(() => {});
    csrfAdminAccess   = null;
    csrfAdminRefresh  = null;
    hmacSigningSecret = null;
    // Null the IDB key so encrypted blobs are unreadable until next login
    _idbCryptoKey    = null;
    _idbAdminUserId  = null;
}

export async function getMe() {
    const r = await authFetch(`${BASE_URL}/admin/auth/me`, { method: 'GET' });
    const d = await parseJson(r, 'Failed to fetch account info');
    if (d.csrf_admin_access)  csrfAdminAccess  = d.csrf_admin_access;
    if (d.csrf_admin_refresh) csrfAdminRefresh = d.csrf_admin_refresh;
    if (d.idb_key && d.id != null) await _setIdbKey(d.idb_key, d.id);
    return d;
}

// ── Admin — permissions/roles ─────────────────────────────────────────────────

export async function getPermissions() {
    const r = await authFetch(`${BASE_URL}/admin/permissions`);
    return (await parseJson(r, 'Failed to fetch permissions')).permissions;
}

export async function getRoles() {
    const r = await authFetch(`${BASE_URL}/admin/roles`);
    return (await parseJson(r, 'Failed to fetch roles')).roles;
}

export async function createRole(name, level, permissions) {
    const r = await authFetch(`${BASE_URL}/admin/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, level, permissions }),
    });
    return (await parseJson(r, 'Failed to create role')).role;
}

export async function updateRole(roleId, fields) {
    const r = await authFetch(`${BASE_URL}/admin/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
    });
    return (await parseJson(r, 'Failed to update role')).role;
}

export async function deleteRole(roleId) {
    const r = await authFetch(`${BASE_URL}/admin/roles/${roleId}`, { method: 'DELETE' });
    return parseJson(r, 'Failed to delete role');
}

export async function cancelRoleDeletion(roleId) {
    const r = await authFetch(`${BASE_URL}/admin/roles/${roleId}/cancel-delete`, { method: 'POST' });
    return parseJson(r, 'Failed to cancel role deletion');
}

// ── Admin — users ─────────────────────────────────────────────────────────────

export async function getUsers() {
    const r = await authFetch(`${BASE_URL}/admin/users`);
    return (await parseJson(r, 'Failed to fetch users')).users;
}

export async function assignRole(userId, role) {
    const r = await authFetch(`${BASE_URL}/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
    });
    return (await parseJson(r, 'Failed to assign role')).user;
}

export async function setPermissionOverride(userId, permission, granted) {
    const r = await authFetch(`${BASE_URL}/admin/users/${userId}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission, granted }),
    });
    return (await parseJson(r, 'Failed to set permission override')).user;
}

export async function unlockUser(userId) {
    const r = await authFetch(`${BASE_URL}/admin/users/${userId}/unlock`, { method: 'POST' });
    return parseJson(r, 'Failed to unlock user');
}

export async function getUserTransactions(userId, offset, limit) {
    const params = new URLSearchParams();
    if (offset != null) params.set('offset', offset);
    if (limit != null) params.set('limit', limit);
    const qs = params.toString() ? `?${params}` : '';
    const r = await authFetch(`${BASE_URL}/admin/users/${userId}/transactions${qs}`);
    return parseJson(r, 'Failed to fetch transactions');
}

// ── Admin — impersonation log ─────────────────────────────────────────────────

export async function getImpersonationLog() {
    const r = await authFetch(`${BASE_URL}/admin/impersonation-log`);
    return (await parseJson(r, 'Failed to fetch impersonation log')).log;
}

export async function revokeToken(jti) {
    const r = await authFetch(`${BASE_URL}/admin/tokens/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jti }),
    });
    return parseJson(r, 'Failed to revoke token');
}

// ── Cashflow — categories ─────────────────────────────────────────────────────

export async function getCategories() {
    const r = await authFetch(`${BASE_URL}/categories`);
    return (await parseJson(r, 'Failed to fetch categories')).categories;
}

export async function createCategory(name, color) {
    const r = await authFetch(`${BASE_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color }),
    });
    return (await parseJson(r, 'Failed to create category')).category;
}

export async function updateCategory(currentName, fields) {
    // Backend uses name as key, not id; categories table has no integer id exposed in API
    const r = await authFetch(`${BASE_URL}/categories`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_name: currentName, ...fields }),
    });
    return (await parseJson(r, 'Failed to update category')).category;
}

export async function deleteCategory(name) {
    const r = await authFetch(`${BASE_URL}/categories`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    return parseJson(r, 'Failed to delete category');
}

export async function cancelCategoryDeletion(name) {
    const r = await authFetch(`${BASE_URL}/categories/cancel-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    return parseJson(r, 'Failed to cancel category deletion');
}

// ── Admin — admin accounts ────────────────────────────────────────────────────

export async function getAdminAccounts() {
    const r = await authFetch(`${BASE_URL}/admin/accounts`);
    return (await parseJson(r, 'Failed to fetch admin accounts')).accounts;
}

export async function createAdminAccount(username, password, role) {
    const r = await authFetch(`${BASE_URL}/admin/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
    });
    return (await parseJson(r, 'Failed to create admin account')).account;
}

export async function deleteAdminAccount(id) {
    const r = await authFetch(`${BASE_URL}/admin/accounts/${id}`, { method: 'DELETE' });
    return parseJson(r, 'Failed to delete admin account');
}

export async function editAdminAccount(id, { role }) {
    const r = await authFetch(`${BASE_URL}/admin/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
    });
    return (await parseJson(r, 'Failed to update admin account')).account;
}

export async function resetAdminMfa(id) {
    const r = await authFetch(`${BASE_URL}/admin/accounts/${id}/reset-mfa`, { method: 'POST' });
    return parseJson(r, 'Failed to reset MFA');
}

// ── Admin — audit log ─────────────────────────────────────────────────────────

export async function getAuditLog({ action = '', actor = '', limit = 200 } = {}) {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (actor)  params.set('actor', actor);
    params.set('limit', limit);
    const r = await authFetch(`${BASE_URL}/admin/audit?${params}`);
    return (await parseJson(r, 'Failed to fetch audit log')).log;
}

// ── Admin — geo logs ──────────────────────────────────────────────────────────

export async function getGeoLogs({ userId = '', from = '', to = '', limit = 1000 } = {}) {
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (from)   params.set('from', from);
    if (to)     params.set('to', to);
    params.set('limit', limit);
    const r = await authFetch(`${BASE_URL}/admin/geo-logs?${params}`);
    return await parseJson(r, 'Failed to fetch geo logs');
}

// Returns {geo_blocked, message} on suspicious activity, or null if ok.
export async function postGeoHeartbeat() {
    const r = await authFetch(`${BASE_URL}/admin/geo/heartbeat`, { method: 'POST' });
    if (r.status === 403) {
        const d = await r.json().catch(() => ({}));
        return { geo_blocked: true, message: d.message || d.error || 'Suspicious activity detected.' };
    }
    await r.json().catch(() => {});
    return null;
}
