const BASE_URL = import.meta.env.PROD
    ? 'https://cashflow2-0.onrender.com'
    : `http://${import.meta.env.VITE_LOCAL_IP || 'localhost'}:${import.meta.env.VITE_BACKEND_PORT || '5050'}`;

const DEFAULT_REQUEST_TIMEOUT_MS = 110000;
const COLD_START_TIMEOUT_MS = 70000;

let csrfAccessToken   = null;
let csrfRefreshToken  = null;
let hmacSigningSecret = null;  // hex string, held in JS memory only

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

function now() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
}

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, onTiming, externalSignal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = now();

    if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } catch (err) {
        if (err.name === 'AbortError') {
            const elapsedMs = now() - startedAt;
            const timeoutError = new Error(
                `Request to ${url} timed out after ${Math.round(elapsedMs)}ms (limit ${timeoutMs}ms)`
            );
            timeoutError.isTimeout = true;
            timeoutError.elapsedMs = elapsedMs;
            throw timeoutError;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
        if (onTiming) onTiming(now() - startedAt);
    }
}

async function parseJsonResponse(response, fallbackMessage) {
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        if (response.status === 502 || response.status === 503) {
            throw new Error('The server is starting up or temporarily unavailable - please try again in a few seconds.');
        }
        throw new Error(`Unexpected server response (status ${response.status}) - please try again.`);
    }
    if (!response.ok) throw new Error(data.error || data.msg || fallbackMessage);
    return data;
}

let refreshPromise = null;

async function tryRefreshAccessToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        let response;
        try {
            response = await fetchWithTimeout(`${BASE_URL}/auth/refresh`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'X-CSRF-TOKEN': csrfRefreshToken },
            }, COLD_START_TIMEOUT_MS);
        } catch (e) {
            const transientError = new Error('Token refresh failed - server unreachable or timed out.');
            transientError.isTransient = true;
            throw transientError;
        } finally {
            refreshPromise = null;
        }

        if (response.ok) {
            const data = await response.json();
            csrfAccessToken = data.csrf_access_token;
            if (data.hmac_signing_secret) hmacSigningSecret = data.hmac_signing_secret;
        } else {
            window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        return response.ok;
    })();

    return refreshPromise;
}

async function authorizedFetch(url, options = {}, timeoutMs, onTiming, signal) {
    const method = options.method || 'GET';
    const path = new URL(url, 'http://x').pathname;
    const hmacHeaders = await computeHmacHeaders(method, path);
    let response = await fetchWithTimeout(url, {
        ...options,
        credentials: 'include',
        headers: {
            ...options.headers,
            'X-CSRF-TOKEN': csrfAccessToken,
            ...hmacHeaders,
        },
    }, timeoutMs, onTiming, signal);

    if (response.status === 401) {
        const refreshed = await tryRefreshAccessToken();
        if (!refreshed) throw new Error('Not logged in');

        const hmacHeaders2 = await computeHmacHeaders(method, path);
        response = await fetchWithTimeout(url, {
            ...options,
            credentials: 'include',
            headers: {
                ...options.headers,
                'X-CSRF-TOKEN': csrfAccessToken,
                ...hmacHeaders2,
            },
        }, timeoutMs, onTiming, signal);
    }
    return response;
}

export async function login(identifier, password, elapsedMs) {
    const field = identifier.includes('@') ? 'email' : 'username';
    const response = await fetchWithTimeout(`${BASE_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: identifier, password, _elapsed_ms: elapsedMs, website: '' }),
    }, COLD_START_TIMEOUT_MS);

    const data = await parseJsonResponse(response, 'Login failed');
    csrfAccessToken  = data.csrf_access_token;
    csrfRefreshToken = data.csrf_refresh_token;
    if (data.hmac_signing_secret) hmacSigningSecret = data.hmac_signing_secret;
    return data;
}

export async function signup(username, password, email) {
    const body = { username, password };
    if (email) body.email = email;
    const response = await fetchWithTimeout(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, COLD_START_TIMEOUT_MS);

    const data = await parseJsonResponse(response, 'Signup failed');
    csrfAccessToken  = data.csrf_access_token;
    csrfRefreshToken = data.csrf_refresh_token;
    if (data.hmac_signing_secret) hmacSigningSecret = data.hmac_signing_secret;
    return data;
}

export async function logout() {
    if (refreshPromise) {
        await refreshPromise.catch(() => {});
    }
    await fetch(`${BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrfAccessToken },
    }).catch(() => {});
    csrfAccessToken   = null;
    csrfRefreshToken  = null;
    hmacSigningSecret = null;
}

export async function getMe() {
    const response = await authorizedFetch(`${BASE_URL}/auth/me`, { method: 'GET' });
    const data = await parseJsonResponse(response, 'Failed to fetch account info');
    if (data.csrf_access_token) csrfAccessToken = data.csrf_access_token;
    if (data.csrf_refresh_token) csrfRefreshToken = data.csrf_refresh_token;
    return data;
}

export async function forgotPassword(email, elapsedMs) {
    const response = await fetchWithTimeout(`${BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, _elapsed_ms: elapsedMs, website: '' }),
    }, 30000);
    return parseJsonResponse(response, 'Request failed');
}

export async function resetPassword(token, password) {
    const response = await fetchWithTimeout(`${BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
    }, 30000);
    const data = await parseJsonResponse(response, 'Password reset failed');
    if (data.code) {
        const err = new Error(data.error || 'Password reset failed');
        err.code = data.code;
        throw err;
    }
    return data;
}

export async function verifyEmail(token) {
    const response = await fetchWithTimeout(
        `${BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`,
        { method: 'GET' },
        30000,
    );
    const data = await parseJsonResponse(response, 'Email verification failed');
    if (data.code) {
        const err = new Error(data.error || 'Verification failed');
        err.code = data.code;
        throw err;
    }
    return data;
}

export async function cancelDeletion(token) {
    const response = await fetchWithTimeout(`${BASE_URL}/auth/cancel-deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
    }, 30000);
    const data = await parseJsonResponse(response, 'Failed to cancel deletion');
    if (data.code) {
        const err = new Error(data.error || 'Failed');
        err.code = data.code;
        throw err;
    }
    return data;
}

export async function updateProfile(fields) {
    const response = await authorizedFetch(`${BASE_URL}/auth/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
    });
    return parseJsonResponse(response, 'Failed to update profile');
}

export async function changePassword(currentPassword, newPassword) {
    const response = await authorizedFetch(`${BASE_URL}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    return parseJsonResponse(response, 'Failed to change password');
}

export async function deleteAccount() {
    const response = await authorizedFetch(`${BASE_URL}/auth/account`, { method: 'DELETE' });
    return parseJsonResponse(response, 'Failed to delete account');
}

export async function sendVerificationEmail() {
    const response = await authorizedFetch(`${BASE_URL}/auth/send-verification`, { method: 'POST' });
    return parseJsonResponse(response, 'Failed to send verification email');
}
