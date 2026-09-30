/**
 * idb/writeQueue.js
 *
 * Durable, replayable queue for writes that must reach the server even if the
 * tab is closed, refreshed or killed first.
 *
 *   enqueue(type, payload)  → stored (encrypted, in the user's own IDB) the
 *                             instant it is called, sent after the handler's
 *                             debounce, removed only once the server accepted it
 *   registerHandler(type, { run, merge?, delayMs? })
 *                           → how a type is sent. `merge(older, newer)` makes
 *                             the type coalescing: a new payload folds into a
 *                             not-yet-sent one instead of queueing another.
 *
 * Outcomes per attempt:
 *   success                 → entry removed (memory + IDB)
 *   network/timeout/429/5xx → kept, retried with backoff (gives up after
 *                             MAX_ATTEMPTS and reports it)
 *   401 / session gone      → kept and retried later: the user may sign in
 *                             again, and the entry replays on next login
 *   any other failure       → dropped, 'idb:mutation-failed' dispatched and a
 *                             queue_dropped diagnostic reported
 *
 * Entries live in the `pending_ops` store of cashflow-db-{userId}. Logging out
 * only forgets the in-memory state; the encrypted rows stay on disk and are
 * replayed after the next sign-in (the key is re-issued by the server).
 *
 * The in-memory array is the source of truth during a session, so the queue
 * keeps working (just without crash-durability) if IndexedDB is unavailable.
 */

import { put, remove, getAll } from './store.js';
import { registerFlusher } from './persistence.js';
import { addReloadGuard } from './reloadGuard.js';
import { reportEvent } from '../diagnostics.js';

const STORE = 'pending_ops';
const MAX_ATTEMPTS = 20;
const MAX_BACKOFF_MS = 60_000;
const AUTH_HOLD_MS = 30_000;

const _handlers = new Map();   // type -> { run, merge?, delayMs? }
let _userId = null;
let _cryptoKey = null;
let _entries = [];             // { id, type, payload, enqueuedAt, attempts, dueAt, inflight }
let _loaded = Promise.resolve();
let _timer = null;
let _drainPromise = null;
let _force = false;
let _keepalive = false;

// ── identity / loading ─────────────────────────────────────────────────────

export function initQueue(userId, cryptoKey) {
  if (_userId !== null && String(_userId) !== String(userId)) _entries = [];
  _userId = userId;
  _cryptoKey = cryptoKey;
  _loaded = _loadPersisted();
  return _loaded;
}

async function _loadPersisted() {
  if (_userId === null || !_cryptoKey) return;
  const userId = _userId;
  const rows = await getAll(userId, STORE, _cryptoKey);
  if (userId !== _userId) return;   // signed out / switched user while reading
  const known = new Set(_entries.map(e => e.id));
  const restored = rows
    .map(r => r.value)
    .filter(v => v && v.id && v.type && !known.has(v.id))
    .sort((a, b) => (a.enqueuedAt || 0) - (b.enqueuedAt || 0))
    .map(v => ({
      id: v.id, type: v.type, payload: v.payload,
      enqueuedAt: v.enqueuedAt || 0, attempts: v.attempts || 0,
      dueAt: 0, inflight: false,
    }));
  if (!restored.length) return;
  _entries = [...restored, ..._entries];   // older (persisted) entries go first
  _scheduleNext();
}

/** Resolves once entries persisted by an earlier session have been loaded. */
export function whenLoaded() {
  return _loaded;
}

/** Forget in-memory state (sign-out). Persisted rows are deliberately kept. */
export function resetQueue() {
  clearTimeout(_timer);
  _timer = null;
  _entries = [];
  _userId = null;
  _cryptoKey = null;
  _loaded = Promise.resolve();
}

// ── handlers ───────────────────────────────────────────────────────────────

export function registerHandler(type, cfg) {
  _handlers.set(type, cfg);
  if (_entries.some(e => e.type === type)) _scheduleNext();
  return () => { if (_handlers.get(type) === cfg) _handlers.delete(type); };
}

/** Payloads of everything still unsent for a type, oldest first. */
export function getPending(type) {
  return _entries.filter(e => e.type === type).map(e => e.payload);
}

// ── enqueue ────────────────────────────────────────────────────────────────

function _newId() {
  try { return crypto.randomUUID(); } catch { return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`; }
}

export function enqueue(type, payload) {
  const cfg = _handlers.get(type) || {};
  const now = Date.now();
  const dueAt = now + (cfg.delayMs ?? 0);

  if (cfg.merge) {
    const target = [..._entries].reverse().find(e => e.type === type && !e.inflight);
    if (target) {
      target.payload = cfg.merge(target.payload, payload);
      target.dueAt = dueAt;
      _persist(target);
      _scheduleNext();
      return target.id;
    }
  }

  const entry = {
    id: _newId(),   // opaque: the row key is stored in the clear, the type is not
    type, payload, enqueuedAt: now, attempts: 0, dueAt, inflight: false,
  };
  _entries.push(entry);
  _persist(entry);
  _scheduleNext();
  return entry.id;
}

// Writes to one entry are chained so a slow earlier write can never land after
// (and overwrite) a newer one; each link writes the entry's *current* payload.
function _persist(entry) {
  if (_userId === null || !_cryptoKey) return;
  const userId = _userId;
  const key = _cryptoKey;
  entry._chain = (entry._chain || Promise.resolve())
    .then(() => (entry.removed ? undefined : put(userId, STORE, entry.id, {
      id: entry.id, type: entry.type, payload: entry.payload,
      enqueuedAt: entry.enqueuedAt, attempts: entry.attempts,
    }, key)))
    .catch(() => {});
}

function _remove(entry) {
  entry.removed = true;
  _entries = _entries.filter(e => e !== entry);
  if (_userId === null) return;
  const userId = _userId;
  entry._chain = (entry._chain || Promise.resolve())
    .then(() => remove(userId, STORE, entry.id))
    .catch(() => {});
}

// ── draining ───────────────────────────────────────────────────────────────

function _scheduleNext() {
  clearTimeout(_timer);
  _timer = null;
  const dues = _entries.filter(e => !e.inflight && _handlers.has(e.type)).map(e => e.dueAt);
  if (!dues.length) return;
  _timer = setTimeout(() => { _timer = null; drain(); }, Math.max(0, Math.min(...dues) - Date.now()));
}

/**
 * Send what is due. `force` ignores the debounce and backoff (tab hiding,
 * going back online, logout); `keepalive` lets those requests outlive the page.
 * The first request of a forced drain is issued synchronously, before any await.
 */
export function drain({ force = false, keepalive = false } = {}) {
  if (force) {
    _force = true;
    _keepalive = _keepalive || keepalive;
  }
  if (_drainPromise) return _drainPromise;
  _drainPromise = _drainLoop().finally(() => {
    _drainPromise = null;
    _scheduleNext();
  });
  return _drainPromise;
}

export function flush() {
  return drain({ force: true, keepalive: true });
}

async function _drainLoop() {
  for (;;) {
    const force = _force;
    const keepalive = _keepalive;
    _force = false;
    _keepalive = false;
    for (const entry of [..._entries]) {
      if (entry.inflight || entry.removed) continue;
      const cfg = _handlers.get(entry.type);
      if (!cfg) continue;
      if (!force && entry.dueAt > Date.now()) continue;
      await _attempt(entry, cfg, keepalive);
    }
    if (!_force) return;
  }
}

function _isTransient(err, status) {
  return status === 0 || status === 408 || status === 429 || status >= 500
    || !!err?.isTransient || !!err?.isTimeout;
}

async function _attempt(entry, cfg, keepalive) {
  entry.inflight = true;
  try {
    await cfg.run(entry.payload, { keepalive });
    _remove(entry);
  } catch (err) {
    entry.inflight = false;
    const status = err?.status ?? 0;
    if (err?.isAuthFailure || status === 401) {
      entry.dueAt = Date.now() + AUTH_HOLD_MS;
    } else if (_isTransient(err, status)) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_ATTEMPTS) {
        _drop(entry, err, 'gave up after repeated failures');
      } else {
        entry.dueAt = Date.now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(entry.attempts, 6));
        _persist(entry);
      }
    } else {
      _drop(entry, err, err?.message);
    }
  }
}

function _drop(entry, err, reason) {
  _remove(entry);
  // Never report a failed report: that would just queue another one.
  if (entry.type !== 'client.events') {
    reportEvent({ kind: 'queue_dropped', status: err?.status, message: `${entry.type}: ${reason || 'failed'}` });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('idb:mutation-failed', {
      detail: { type: entry.type, error: err?.message ?? 'Server error' },
    }));
  }
}

// ── automatic triggers ─────────────────────────────────────────────────────

registerFlusher(() => drain({ force: true, keepalive: true }));

// Don't auto-reload for a new deploy while edits are still unsent.
addReloadGuard(() => _entries.length === 0);

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => drain());
  window.addEventListener('online', () => drain({ force: true }));
  window.addEventListener('pagehide', () => drain({ force: true, keepalive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') drain({ force: true, keepalive: true });
  });
}
