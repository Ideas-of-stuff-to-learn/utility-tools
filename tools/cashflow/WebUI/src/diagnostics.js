/**
 * diagnostics.js
 *
 * One place for the app to say "something failed": a failed network call, a
 * timeout, the boot falling back from the local cache to the network, an
 * IndexedDB stall. Events are cleaned here and handed to a sink (the durable
 * write queue, wired up once the user is signed in) which delivers them in
 * batches to POST /client-events, where admins read them.
 *
 * This module imports nothing on purpose: the lowest layers (idb/store.js,
 * idb/bootSnapshot.js) report through it, so it must not depend on them.
 *
 * Never put request/response bodies, tokens or user data in an event. Only the
 * path (no query string), method, status, timing and a short message.
 */

const MAX_BUFFER = 50;
const DEDUPE_WINDOW_MS = 30_000;
const MAX_TRACKED_KEYS = 200;

let _sink = null;
const _buffer = [];            // events reported before a sink exists (e.g. before sign-in)
const _lastSeen = new Map();   // dedupe key -> timestamp

function _stripQuery(p) {
    return typeof p === 'string' ? p.split('?')[0].split('#')[0].slice(0, 200) : undefined;
}

function _clean(evt) {
    const e = { kind: String(evt.kind), at: Date.now() };
    if (evt.method) e.method = String(evt.method).toUpperCase().slice(0, 10);
    if (evt.path) e.path = _stripQuery(evt.path);
    if (Number.isFinite(evt.status)) e.status = Math.round(evt.status);
    if (Number.isFinite(evt.duration_ms)) e.duration_ms = Math.max(0, Math.round(evt.duration_ms));
    // Messages can echo a request URL (with its query string); keep none of it.
    if (evt.message) e.message = String(evt.message).replace(/https?:\/\/\S+/g, '<url>').slice(0, 300);
    if (evt.detail && typeof evt.detail === 'object') e.detail = evt.detail;
    try { e.page = _stripQuery(location.pathname); } catch { /* no window */ }
    return e;
}

// A retry loop against a dead server must not turn into a flood of reports.
function _isDuplicate(e) {
    const key = [e.kind, e.method, e.path, e.status, e.message].join('|');
    const now = Date.now();
    const prev = _lastSeen.get(key);
    if (prev !== undefined && now - prev < DEDUPE_WINDOW_MS) return true;
    if (_lastSeen.size >= MAX_TRACKED_KEYS) _lastSeen.delete(_lastSeen.keys().next().value);
    _lastSeen.set(key, now);
    return false;
}

export function reportEvent(evt) {
    try {
        if (!evt || !evt.kind) return;
        const e = _clean(evt);
        if (_isDuplicate(e)) return;
        if (_sink) {
            _sink(e);
        } else {
            _buffer.push(e);
            if (_buffer.length > MAX_BUFFER) _buffer.shift();
        }
    } catch {
        // Diagnostics must never break the app.
    }
}

export function setDiagnosticsSink(fn) {
    _sink = fn;
    if (!fn) return;
    for (const e of _buffer.splice(0)) {
        try { fn(e); } catch { /* ignore */ }
    }
}

export function clearDiagnosticsSink() {
    _sink = null;
}
