import {url} from '../../frontendLocalConfig'
import { simulateColdStart, coldStartSimulatedSeconds } from '../../devConfig'
import { UPLOAD_WINDOW_MODE, UPLOAD_WINDOW_DURATION_VALUE, UPLOAD_WINDOW_DURATION_UNIT } from './config/uploadWindowConfig';


const BASE_URL = url;
// Fallback timeout if a caller doesn't specify one. Callers that care
// (useFileProcessor.js) pass their own timeoutMs tied to the backend's
// actual worker timeout - this is just a safety net for anything that
// doesn't.
const DEFAULT_REQUEST_TIMEOUT_MS = 110000;

// How long a normal (non-categorization) request waits before giving
// up with a user-friendly "server is starting up" message. Set to 70s
// to give Render's free tier enough room to cold-start (~30-60s
// typical) while still failing clearly rather than hanging forever.
// Distinct from DEFAULT_REQUEST_TIMEOUT_MS which is for categorization
// requests specifically, where the worker timeout governs timing.
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

export async function getUploadBreakdown() {
    const params = new URLSearchParams({
        mode: UPLOAD_WINDOW_MODE,
        duration_value: UPLOAD_WINDOW_DURATION_VALUE,
        duration_unit: UPLOAD_WINDOW_DURATION_UNIT,
    });
    const response = await authorizedFetch(`${BASE_URL}/uploads/breakdown?${params.toString()}`, { method: 'GET' });
    return await parseJsonResponse(response, 'Failed to fetch upload breakdown');
}

function now() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
}



// Wraps fetch with a client-side timeout (AbortController) and reports
// how long the request actually took via onTiming, regardless of
// whether it succeeded, failed, or timed out.
//
// Why this exists: the backend's worker has its own hard timeout (see
// WORKER_TIMEOUT_SECONDS in useFileProcessor.js) - if it's exceeded,
// the worker gets killed mid-request with no graceful response at all,
// which just looks like a hung/dropped connection to us. Aborting
// client-side slightly BEFORE that happens means we get a clear,
// catchable timeout error instead of an ambiguous network failure, and
// callers can react to it deliberately (see useFileProcessor.js).
async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, onTiming, externalSignal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = now();

    // If the caller also gave us a signal (e.g. tied to a component's
    // unmount/logout), abort our own controller the moment theirs
    // fires - lets an external cancellation reason (not just our own
    // timeout) actually stop the in-flight fetch.
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

// Every endpoint below used to do `const data = await response.json()`
// directly. That's fine when the Flask app answers - but if the backend
// worker has crashed, is mid-restart, or the request hit a proxy-level
// error, Render's OWN infrastructure answers instead, with an HTML error
// page (starting with "<"), not JSON. JSON.parse on that throws a raw,
// confusing "Unexpected character: <" with no indication of what
// actually went wrong. This reads the body as text first, tries to
// parse it, and if that fails, throws a clear message describing what
// actually happened instead.
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
    // flask_jwt_extended's OWN error responses (expired/invalid/revoked
    // token, missing fresh token) use a `msg` field, not `error` -
    // different from every route THIS app writes itself, which always
    // uses `error`. Falling back to `data.msg` here means a 401 from
    // the JWT layer itself ("Token has been revoked", "Fresh token
    // required", etc.) surfaces its own real reason instead of the
    // generic fallback message every caller passes in.
    if (!response.ok) throw new Error(data.error || data.msg || fallbackMessage);
    return data;
}


// Exchanges the stored refresh token for a new access token. Returns
// the new access token on success, or null if the refresh token itself
// was genuinely rejected (missing, expired, or revoked) - in which
// case both stored tokens are cleared, since a dead refresh token left
// sitting in SecureStore would just fail the exact same way again on
// the next attempt.
//
// A TRANSIENT failure (timeout, network error, backend unreachable)
// throws instead of returning null, with .isTransient set - this is
// the actual fix for a real bug: it used to return null for THIS case
// too, which authorizedFetch below then reported as "Not logged in" -
// wrong and misleading, since nothing about the person's login was
// actually invalid, the refresh request just couldn't complete. Now
// authorizedFetch can tell "genuinely logged out" apart from "server
// was briefly unreachable" and give an accurate, retry-worthy error
// for the latter instead.
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
            // Refresh token itself was rejected — session is genuinely dead.
            // Signal the app to kick the user to the login screen.
            window.dispatchEvent(new CustomEvent('auth:session-expired'));
        }
        return response.ok;
    })();

    return refreshPromise;
}
// The one place every authenticated call in this file goes through.
// Attaches the current access token, makes the request, and if the
// backend answers 401 (expired access token, or revoked via
// /auth/logout or /admin/tokens/revoke), transparently tries ONE
// refresh-and-retry before giving up - the silent "stay logged in"
// behaviour this app relies on instead of asking for a password every
// 24 hours. Only throws "Not logged in" if that retry also fails,
// matching the exact message every existing caller already checks for
// - no call site elsewhere in this file needed to change its own
// error handling for this.
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
// Resets `color` back to `default_color` for the given category names -
// admin-only, same scoping convention as updateCategory (applies to a
// selected set, not the whole table). Returns the full refreshed
// category list, same shape as getCategories().
export async function resetCategoryDefaults(names) {
    const response = await authorizedFetch(`${BASE_URL}/categories/reset-defaults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
    });

    return await parseJsonResponse(response, 'Reset to defaults failed');
}

// Total number of CSV files this user has ever uploaded - powers the
// "you've uploaded N files" summary on the home screen.
export async function getUploadCount(signal) {
    const response = await authorizedFetch(`${BASE_URL}/uploads/count`, { method: 'GET' }, undefined, undefined, signal);

    const data = await parseJsonResponse(response, 'Failed to fetch upload count');
    return data.count;
}

export async function getCategories(signal) {
    const response = await authorizedFetch(`${BASE_URL}/categories`, { method: 'GET' }, undefined, undefined, signal);
    const data = await parseJsonResponse(response, 'Failed to fetch categories');
    return data.categories;
}

export async function updateCategory(categoryName, { newName, color } = {}) {
    const body = { current_name: categoryName };
    if (newName) body.new_name = newName;
    if (color) body.color = color;

    // current_name now travels in the body, not the URL - some category
    // names contain a literal "/" (e.g. "Sports/Fitness"), and a
    // URL-encoded slash gets handled specially by a lot of web
    // infrastructure for security reasons, which meant it could get
    // rejected before Flask's own routing ever saw it - regardless of
    // encodeURIComponent on this end. Request bodies have no such
    // restriction on any character.
    const response = await authorizedFetch(`${BASE_URL}/categories`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    return await parseJsonResponse(response, 'Failed to update category');
}

// Without arguments: fetches all transactions in one shot (CLI callers,
// manageUserTransactionsAdmin.py, etc. - the old behaviour preserved).
// With { offset, limit }: fetches one page and returns
// { transactions, total, offset, limit } so the caller knows the full
// count and can loop for subsequent pages.
export async function getTransactionHistory({ offset, limit } = {}, signal) {
    const params = new URLSearchParams();
    if (offset !== undefined) params.set('offset', offset);
    if (limit !== undefined) params.set('limit', limit);
    const qs = params.toString();

    const response = await authorizedFetch(
        `${BASE_URL}/transactions${qs ? '?' + qs : ''}`,
        { method: 'GET' },
        undefined,
        undefined,
        signal,
    );

    const data = await parseJsonResponse(response, 'Failed to fetch transaction history');
    return limit !== undefined ? data : data.transactions;
}

export async function deleteTransactions(ids) {
    const response = await authorizedFetch(`${BASE_URL}/transactions`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    });

    const data = await parseJsonResponse(response, 'Delete failed');
    return data.deleted;
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

export async function login(identifier, password, elapsedMs) {
    // identifier may be an email or a username — backend routes by presence of @
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

// Returns { username, role, level, permissions } for whoever the
// current token belongs to. Used by AppContext to decide whether to
// show the role badge (RoleBadge.js) - a plain 'user' (level 0) sees
// nothing different; anything above that shows their role name top
// right of every screen. Also usable by future admin-facing screens
// that need to know "am I even allowed to see this control."
export async function getMe() {
    if (simulateColdStart && import.meta.env.VITE_LOCAL_DEV === 'true') await new Promise(r => setTimeout(r, coldStartSimulatedSeconds * 1000));
    const response = await authorizedFetch(`${BASE_URL}/auth/me`, { method: 'GET' });
    const data = await parseJsonResponse(response, 'Failed to fetch account info');
    if (data.csrf_access_token) csrfAccessToken = data.csrf_access_token;
    if (data.csrf_refresh_token) csrfRefreshToken = data.csrf_refresh_token;
    return data;
}
// Actually revokes the current session server-side now (see
// handoff5.txt/handoff6.txt for why the OLD logout() - which only ever
// cleared local SecureStore - was never enough on its own). Sends the
// stored refresh token along in the body too, so ONE call revokes both
// halves of the session; the backend independently verifies that
// token's signature before touching it; a missing or already-invalid
// refresh token doesn't fail the whole logout, it's silently skipped
// server-side.
//
// Deliberately best-effort: if the network call fails outright (no
// connectivity), local tokens are STILL cleared - the device should
// always be able to "forget" its own session even if it can't reach
// the backend to un-issue it, so the person is never stuck unable to
// log out just because they're offline.
// Clears local tokens immediately (so the UI responds instantly - no
// waiting on a network call), then fires the server-side revocation in
// the background without awaiting it. The server call is best-effort:
// if it fails (offline, cold start, whatever), the tokens are already
// gone from this device so the session is practically dead anyway -
// the revoked_tokens table entry just won't exist, meaning the token
// could theoretically still work from somewhere else that has a copy,
// but that's an acceptable tradeoff for an instant logout experience
// versus the old behaviour of waiting for the round-trip first.
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

export async function sendVerificationEmail() {
    const response = await authorizedFetch(`${BASE_URL}/auth/send-verification`, { method: 'POST' });
    return parseJsonResponse(response, 'Failed to send verification email');
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

export async function getPreferences() {
    const response = await authorizedFetch(`${BASE_URL}/preferences`, { method: 'GET' });
    return response.json();
}

export async function putPreferences(patch) {
    await authorizedFetch(`${BASE_URL}/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
    });
}

export async function categorizeCached(transactions, { timeoutMs, onTiming } = {}) {
    const response = await authorizedFetch(`${BASE_URL}/categorize/cached`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
    }, timeoutMs, onTiming);

    const data = await parseJsonResponse(response, 'Cache lookup failed');
    return data.transactions;
}

// Three separate calls, one per cache-tier phase (exact -> merchant ->
// similarity), instead of the single combined categorizeCached() above.
// Each is its own round trip so the caller (useFileProcessor.js) can
// apply a phase's results - and let the person SEE them - as soon as
// they land, rather than waiting for all three tiers to finish before
// anything updates. Same request/response shape as categorizeCached,
// just three thinner slices of the same underlying work.
export async function categorizeCachedExact(
    transactions,
    { timeoutMs, onTiming } = {}
) {
    let httpElapsedMs;

    const response = await authorizedFetch(
        `${BASE_URL}/categorize/cached/exact`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions }),
        },
        timeoutMs,
        (elapsedMs) => {
            httpElapsedMs = elapsedMs;
            onTiming?.(elapsedMs);
        }
    );

    const data = await parseJsonResponse(
        response,
        'Exact cache lookup failed'
    );

    return {
        transactions: data.transactions,
        backendTimings: data.timings,
        httpElapsedMs,
    };
}

export async function categorizeCachedMerchant(
    transactions,
    { timeoutMs, onTiming } = {}
) {
    let httpElapsedMs;

    const response = await authorizedFetch(
        `${BASE_URL}/categorize/cached/merchant`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions }),
        },
        timeoutMs,
        (elapsedMs) => {
            httpElapsedMs = elapsedMs;
            onTiming?.(elapsedMs);
        }
    );

    const data = await parseJsonResponse(
        response,
        'Merchant lookup failed'
    );

    return {
        transactions: data.transactions,
        backendTimings: data.timings,
        httpElapsedMs,
    };
}

export async function categorizeCachedSimilarity(
    transactions,
    { timeoutMs, onTiming } = {}
) {
    let httpElapsedMs;

    const response = await authorizedFetch(
        `${BASE_URL}/categorize/cached/similarity`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions }),
        },
        timeoutMs,
        (elapsedMs) => {
            httpElapsedMs = elapsedMs;
            onTiming?.(elapsedMs);
        }
    );

    const data = await parseJsonResponse(
        response,
        'Similarity lookup failed'
    );

    return {
        transactions: data.transactions,
        backendTimings: data.timings,
        httpElapsedMs,
    };
}

export async function categorizeLLM(
    transactions,
    {
        timeoutMs,
        onTiming,
        batchSize,
        geminiTimeoutMs
    } = {}
) {
    const body = { transactions };

    if (batchSize != null) {
        body.batch_size = batchSize;
    }

    if (geminiTimeoutMs != null) {
        body.gemini_timeout_ms = geminiTimeoutMs;
    }

    let httpElapsedMs;

    const response = await authorizedFetch(
        `${BASE_URL}/categorize/llm`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        timeoutMs,
        (elapsedMs) => {
            httpElapsedMs = elapsedMs;
            onTiming?.(elapsedMs);
        }
    );

    const data = await parseJsonResponse(
        response,
        'LLM categorisation failed'
    );

    return {
        transactions: data.transactions,
        httpElapsedMs,
        backendTimings: data.timings,
    };
}

export async function parseCSVFiles(files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('files', file, file.name);
    }

    const response = await authorizedFetch(`${BASE_URL}/api/parse-csv`, {
        method: 'POST',
        body: formData,
    });

    const data = await parseJsonResponse(response, 'Failed to parse CSV');
    return {
        transactions: data.transactions,
        duplicateFilenames: data.duplicate_filenames ?? [],
        duplicateContents: data.duplicate_contents ?? [],
        batchCopyDuplicates: data.batch_copy_duplicates ?? [],
        successfulCount: data.successful_count ?? 0,
    };
}

export async function categorizeTransactions(transactions) {
    const response = await authorizedFetch(`${BASE_URL}/categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
    });

    const data = await parseJsonResponse(response, 'Categorization failed');
    return data.transactions;
}

export async function resolveCategories(resolutions) {
    const response = await authorizedFetch(`${BASE_URL}/categorize/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutions }),
    });

    return await parseJsonResponse(response, 'Resolve failed');
}

export async function resolveAndExit(resolutions = []) {
    const response = await authorizedFetch(`${BASE_URL}/categorize/resolve-and-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutions }),
    });
    return await parseJsonResponse(response, 'Resolve-and-exit failed');
}

export async function resolveRemainingToOther() {
    const response = await authorizedFetch(`${BASE_URL}/categorize/resolve-remaining-to-other`, {
        method: 'POST',
    });

    return await parseJsonResponse(response, 'Resolve remaining failed');
}

export function beaconResolveRemainingToOther() {
    navigator.sendBeacon(`${BASE_URL}/categorize/resolve-remaining-to-other`);
}

// Pre-aggregated (year, category) and (year, month, category) sums for
// the Charts screen - computed inside Postgres, not client-side, so the
// payload stays small (bounded by years x months x categories) no
// matter how much raw transaction history has accumulated. Returns
// { yearly: [...], monthly: [...] }.
export async function getChartSummary() {
    const response = await authorizedFetch(`${BASE_URL}/charts/summary`, { method: 'GET' });

    return await parseJsonResponse(response, 'Failed to fetch chart summary');
}