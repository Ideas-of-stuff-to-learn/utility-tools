import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { get as idbGet, put as idbPut } from '../idb/store.js';
import { getIdbKey, getIdbUserId, getPreferences, putPreferences } from '../api';
import { registerHandler, enqueue, drain, getPending, whenLoaded } from '../idb/writeQueue';

// ─── IDB preference keys ──────────────────────────────────────────────────
const IDB_STORE       = 'preferences';
const K_COL_DESKTOP   = 'columnWidthsDesktop';
const K_COL_MOBILE    = 'columnWidthsMobile';
const K_STACK_ORDER   = 'chartStackOrder';
const K_STACK_PERSIST = 'chartStackOrderPersist';
const K_MR_PICKS      = 'mr_pending_picks';

// ─── IDB helpers ──────────────────────────────────────────────────────────
async function idbReadPref(key, fallback = null) {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return fallback;
    const val = await idbGet(userId, IDB_STORE, key, cryptoKey);
    return val !== null ? val : fallback;
}

async function idbWritePref(key, value) {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return;
    await idbPut(userId, IDB_STORE, key, value, cryptoKey);
}

// ─── server helpers ────────────────────────────────────────────────────────
async function serverGet() {
    try {
        return await getPreferences();
    } catch { return null; }
}

// ─── context ──────────────────────────────────────────────────────────────
const UserPreferencesContext = createContext(null);

export function UserPreferencesProvider({ children }) {
    const { idbReady } = useAuth();
    // True once the local (IDB) copy has been read — consumers that must act
    // on saved prefs at boot (manual-review picks) wait for this.
    const [localPrefsReady, setLocalPrefsReady] = useState(false);

    // ── state (null/empty defaults until IDB/server hydrates) ─────────────
    const [columnWidthsDesktop, _setColWidthsDesktop] = useState({});
    const [columnWidthsMobile,  _setColWidthsMobile]  = useState({});
    const [stackOrder,   _setStackOrder]   = useState(null);
    const [stackPersist, _setStackPersist] = useState(false);
    const [mrPicks,      _setMrPicks]      = useState(null);
    // Custom stack order the user hasn't chosen to remember: session-only,
    // but kept here so it survives chart remounts.
    const [sessionStackOrder, setSessionStackOrder] = useState(null);

    // ── server sync (durable write queue) ──────────────────────────────────
    // Every edit is stored encrypted on disk the moment it is made and sent
    // ~2 s later, coalesced with any further edits. The queue itself flushes
    // when the tab hides/closes and before hard navigations (idb/persistence).
    // If the tab is killed first, the edit is replayed after the next sign-in
    // and re-applied over the server's copy in hydrate() below.
    useEffect(() => registerHandler('prefs.patch', {
        run: (patch, { keepalive }) => putPreferences(patch, { keepalive }),
        merge: (older, newer) => ({ ...older, ...newer }),
        delayMs: 2000,
    }), []);

    function scheduleSync(patch) {
        enqueue('prefs.patch', patch);
    }

    const flushNow = useCallback(() => drain({ force: true, keepalive: true }), []);

    // ── hydrate on login ───────────────────────────────────────────────────
    // Gated on idbReady, never on a hint: until /auth/me has returned, the
    // HMAC secret and IDB key don't exist, so both steps would fail — and the
    // server call's 401 used to kick off the refresh → logout → bounce loop.
    // Step 1: read IDB (encrypted local copy)
    // Step 2: fetch server in background (authoritative, overwrites IDB if different)
    useEffect(() => {
        if (!idbReady) return;
        let cancelled = false;

        async function hydrate() {
            // Ask the server right away, in parallel with the local read, so a
            // slow or stalled IndexedDB never delays authoritative prefs. Local
            // values are still applied first, then the server's on top.
            const remotePromise = serverGet();

            // Step 1 — IDB (instant, best-effort)
            const [cwd, cwm, so, sp, mr] = await Promise.all([
                idbReadPref(K_COL_DESKTOP, {}),
                idbReadPref(K_COL_MOBILE, {}),
                idbReadPref(K_STACK_ORDER, null),
                idbReadPref(K_STACK_PERSIST, false),
                idbReadPref(K_MR_PICKS, null),
            ]);
            if (cancelled) return;
            if (Object.keys(cwd).length) _setColWidthsDesktop(cwd);
            if (Object.keys(cwm).length) _setColWidthsMobile(cwm);
            if (so)  _setStackOrder(so);
            if (sp)  _setStackPersist(sp);
            if (mr)  _setMrPicks(mr);
            setLocalPrefsReady(true);

            // Step 2 — server (authoritative)
            const remote = await remotePromise;
            if (cancelled) return;
            if (remote) {
                if (remote.columnWidthsDesktop) {
                    _setColWidthsDesktop(remote.columnWidthsDesktop);
                    idbWritePref(K_COL_DESKTOP, remote.columnWidthsDesktop);
                }
                if (remote.columnWidthsMobile) {
                    _setColWidthsMobile(remote.columnWidthsMobile);
                    idbWritePref(K_COL_MOBILE, remote.columnWidthsMobile);
                }
                if (remote.stackOrder) {
                    _setStackOrder(remote.stackOrder);
                    idbWritePref(K_STACK_ORDER, remote.stackOrder);
                }
                if (remote.stackPersist != null) {
                    _setStackPersist(remote.stackPersist);
                    idbWritePref(K_STACK_PERSIST, remote.stackPersist);
                }
                if (remote.mrPicks) {
                    _setMrPicks(remote.mrPicks);
                    idbWritePref(K_MR_PICKS, remote.mrPicks);
                }
            }

            // Step 3 — edits the server has not confirmed yet (made before a
            // refresh or a killed tab, or since this load began) are newer than
            // its copy, so they win. The queue is already sending them.
            await whenLoaded();
            if (cancelled) return;
            const pending = Object.assign({}, ...getPending('prefs.patch'));
            if ('columnWidthsDesktop' in pending) {
                _setColWidthsDesktop(pending.columnWidthsDesktop ?? {});
                idbWritePref(K_COL_DESKTOP, pending.columnWidthsDesktop ?? {});
            }
            if ('columnWidthsMobile' in pending) {
                _setColWidthsMobile(pending.columnWidthsMobile ?? {});
                idbWritePref(K_COL_MOBILE, pending.columnWidthsMobile ?? {});
            }
            if ('stackOrder' in pending) {
                _setStackOrder(pending.stackOrder ?? null);
                idbWritePref(K_STACK_ORDER, pending.stackOrder ?? null);
            }
            if ('stackPersist' in pending) {
                _setStackPersist(pending.stackPersist ?? false);
                idbWritePref(K_STACK_PERSIST, pending.stackPersist ?? false);
            }
            if ('mrPicks' in pending) {
                _setMrPicks(pending.mrPicks ?? null);
                idbWritePref(K_MR_PICKS, pending.mrPicks ?? null);
            }
        }

        hydrate();
        return () => { cancelled = true; };
    }, [idbReady]);

    // ── setters (IDB + state + debounced server) ───────────────────────────
    const setColumnWidthsDesktop = useCallback((widths) => {
        _setColWidthsDesktop(widths);
        idbWritePref(K_COL_DESKTOP, widths);
        scheduleSync({ columnWidthsDesktop: widths });
    }, []);

    const setColumnWidthsMobile = useCallback((widths) => {
        _setColWidthsMobile(widths);
        idbWritePref(K_COL_MOBILE, widths);
        scheduleSync({ columnWidthsMobile: widths });
    }, []);

    const setStackOrder = useCallback((order) => {
        _setStackOrder(order);
        idbWritePref(K_STACK_ORDER, order);
        scheduleSync({ stackOrder: order });
    }, []);

    const setStackPersist = useCallback((value) => {
        _setStackPersist(value);
        idbWritePref(K_STACK_PERSIST, value);
        scheduleSync({ stackPersist: value });
    }, []);

    // null must be written too: skipping it left already-resolved picks in
    // IDB, and every later boot re-sent them to the server.
    const setMrPicks = useCallback((picks) => {
        _setMrPicks(picks);
        idbWritePref(K_MR_PICKS, picks);
        scheduleSync({ mrPicks: picks });
    }, []);

    return (
        <UserPreferencesContext.Provider value={{
            columnWidthsDesktop, setColumnWidthsDesktop,
            columnWidthsMobile,  setColumnWidthsMobile,
            stackOrder,          setStackOrder,
            stackPersist, setStackPersist,
            sessionStackOrder, setSessionStackOrder,
            mrPicks,      setMrPicks,
            localPrefsReady,
            flushNow,
        }}>
            {children}
        </UserPreferencesContext.Provider>
    );
}

export function useUserPreferences() {
    const ctx = useContext(UserPreferencesContext);
    if (!ctx) throw new Error('useUserPreferences must be inside UserPreferencesProvider');
    return ctx;
}
