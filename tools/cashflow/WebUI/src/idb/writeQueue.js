/**
 * idb/writeQueue.js
 *
 * Optimistic write queue: mutations are applied to IDB immediately then
 * queued for server sync. The queue drains in order; on permanent failure
 * the rollback function is called and an 'idb:mutation-failed' event is
 * dispatched for the UI to show an error toast.
 *
 * Auto-drain triggers: after every enqueue, on window focus, on window online.
 */

import { put, remove, clearStore } from './store.js';

let _userId = null;
let _cryptoKey = null;
let _draining = false;

// In-memory queue — source of truth during a session.
// IDB write_queue store is the durable backup across refreshes.
const _queue = [];

export function initQueue(userId, cryptoKey) {
  _userId = userId;
  _cryptoKey = cryptoKey;
}

/**
 * Enqueue a mutation. Applies the optimistic update immediately.
 * @param {{
 *   type: string,
 *   optimisticFn: () => void,
 *   rollbackFn: () => void,
 *   serverFn: () => Promise<any>,
 * }} op
 */
export async function enqueue(op) {
  op.optimisticFn?.();
  _queue.push(op);

  // Persist to IDB as durable backup (best-effort, not required for correctness)
  if (_userId && _cryptoKey) {
    try {
      await put(_userId, 'write_queue', `q-${Date.now()}-${Math.random()}`, {
        type: op.type,
        enqueuedAt: Date.now(),
      }, _cryptoKey);
    } catch {
      // Non-fatal — in-memory queue still has the entry
    }
  }

  drain();
}

let _drainPromise = null;

export function drain() {
  if (_drainPromise) return _drainPromise;
  _drainPromise = _drainLoop().finally(() => { _drainPromise = null; });
  return _drainPromise;
}

async function _drainLoop() {
  if (_draining) return;
  _draining = true;
  try {
    while (_queue.length > 0) {
      const op = _queue[0];
      const success = await _attempt(op);
      if (success) {
        _queue.shift();
      } else {
        break; // Stop draining — will retry on next trigger
      }
    }
  } finally {
    _draining = false;
  }
}

const _TRANSIENT_STATUSES = new Set([0, 429, 502, 503, 504]);
const _MAX_RETRIES = 3;

async function _attempt(op, retries = 0) {
  try {
    await op.serverFn();
    return true;
  } catch (err) {
    const status = err?.status ?? 0;
    if (_TRANSIENT_STATUSES.has(status) && retries < _MAX_RETRIES) {
      await _delay(500 * 2 ** retries);
      return _attempt(op, retries + 1);
    }
    // Permanent failure — rollback and notify UI
    try { op.rollbackFn?.(); } catch {}
    window.dispatchEvent(new CustomEvent('idb:mutation-failed', {
      detail: { type: op.type, error: err?.message ?? 'Server error' },
    }));
    return true; // Remove from queue even on permanent failure — already rolled back
  }
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Called on beforeunload — fires remaining queue entries via sendBeacon
 * where possible (fire-and-forget, no rollback possible here).
 */
export function flush() {
  for (const op of _queue) {
    try {
      op.serverFn?.({ beacon: true });
    } catch {}
  }
}

export function clearQueue(userId) {
  _queue.length = 0;
  if (userId) clearStore(userId, 'write_queue').catch(() => {});
}

// Auto-drain on focus + online
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => drain());
  window.addEventListener('online', () => drain());
}
