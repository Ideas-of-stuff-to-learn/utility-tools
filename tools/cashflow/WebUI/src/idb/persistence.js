// Pending local writes (IDB snapshot, debounced preference sync) register a
// flusher here so hard navigations ("Back to Tools") can finish them first.

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

// The stale-build guard awaits this before it reloads the page for a new
// deploy, so pending local writes get a chance to finish first.
if (typeof window !== 'undefined') window.__versionFlush = () => flushAll(1500);
