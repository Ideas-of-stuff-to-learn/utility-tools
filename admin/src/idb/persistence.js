// Admin-panel flush registry.
//
// Pending writes (write queue entries, deferred IDB puts) register a flusher
// here so hard navigations can finish them before the page unloads.
// Separate from the cashflow WebUI version — no shared imports.

const _flushers = new Set();

export function registerFlusher(fn) {
  _flushers.add(fn);
  return () => _flushers.delete(fn);
}

export async function flushAll(timeoutMs = 1500) {
  const work = Promise.allSettled([..._flushers].map(fn => {
    try { return fn(); } catch { return null; }
  }));
  await Promise.race([work, new Promise(r => setTimeout(r, timeoutMs))]);
}

// The stale-build guard awaits this before reloading the page for a new
// deploy, so any pending admin writes get a chance to finish first.
if (typeof window !== 'undefined') window.__versionFlush = () => flushAll(1500);
