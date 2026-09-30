import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { get as idbGet, put as idbPut } from '../idb/store.js';
import { getIdbKey, getIdbUserId, getPreferences, putPreferences } from '../api';
import { registerFlusher } from '../idb/persistence';

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
async function serverPut(patch, opts) {
    try {
        await putPreferences(patch, opts);
    } catch (e) {
        console.warn('[UserPrefs] server sync failed:', e.message);
    }
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

    // ── debounce ref for server sync ───────────────────────────────────────
    const syncTimer    = useRef(null);
    const pendingPatch = useRef({});

    function scheduleSync(patch) {
        Object.assign(pendingPatch.current, patch);
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
            const p = { ...pendingPatch.current };
            pendingPatch.current = {};
            serverPut(p);
        }, 2000);
    }

    const flushNow = useCallback((opts) => {
        if (syncTimer.current) {
            clearTimeout(syncTimer.current);
            syncTimer.current = null;
        }
        const p = { ...pendingPatch.current };
        pendingPatch.current = {};
        if (Object.keys(p).length > 0) return serverPut(p, opts);
        return Promise.resolve();
    }, []);

    // Hard navigations await this (idb/persistence.flushAll); tab close /
    // backgrounding falls back to a keepalive request that outlives the page.
    useEffect(() => registerFlusher(() => flushNow({ keepalive: true })), [flushNow]);
    useEffect(() => {
        function onHide() {
            if (document.visibilityState === 'hidden') flushNow({ keepalive: true });
        }
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', onHide);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onHide);
        };
    }, [flushNow]);

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
            if (cancelled || !remote) return;
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
