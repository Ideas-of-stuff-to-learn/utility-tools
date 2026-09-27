import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { url as BASE_URL } from '../../../frontendLocalConfig';
import { get as idbGet, put as idbPut } from '../idb/store.js';
import { getIdbKey, getIdbUserId } from '../api';

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
        const { getPreferences } = await import('../api');
        return await getPreferences();
    } catch { return null; }
}
async function serverPut(patch) {
    try {
        const { putPreferences } = await import('../api');
        await putPreferences(patch);
    } catch (e) {
        console.warn('[UserPrefs] server sync failed:', e.message);
    }
}

// ─── context ──────────────────────────────────────────────────────────────
const UserPreferencesContext = createContext(null);

export function UserPreferencesProvider({ children }) {
    const { isLoggedIn } = useAuth();

    // ── state (null/empty defaults until IDB/server hydrates) ─────────────
    const [columnWidthsDesktop, _setColWidthsDesktop] = useState({});
    const [columnWidthsMobile,  _setColWidthsMobile]  = useState({});
    const [stackOrder,   _setStackOrder]   = useState(null);
    const [stackPersist, _setStackPersist] = useState(false);
    const [mrPicks,      _setMrPicks]      = useState(null);

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

    const flushNow = useCallback(() => {
        if (syncTimer.current) {
            clearTimeout(syncTimer.current);
            syncTimer.current = null;
        }
        const p = { ...pendingPatch.current };
        pendingPatch.current = {};
        if (Object.keys(p).length > 0) serverPut(p);
    }, []);

    // ── hydrate on login ───────────────────────────────────────────────────
    // Step 1: read IDB instantly (encrypted cache, in-process async, ~1ms)
    // Step 2: fetch server in background (authoritative, overwrites IDB if different)
    useEffect(() => {
        if (!isLoggedIn) return;
        let cancelled = false;

        async function hydrate() {
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

            // Step 2 — server (authoritative)
            const remote = await serverGet();
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
    }, [isLoggedIn]);

    // ── flush to server on page unload ─────────────────────────────────────
    useEffect(() => {
        if (!isLoggedIn) return;
        function handleBeforeUnload() {
            if (syncTimer.current) {
                clearTimeout(syncTimer.current);
                syncTimer.current = null;
            }
            const p = { ...pendingPatch.current };
            pendingPatch.current = {};
            if (Object.keys(p).length === 0) return;
            try {
                fetch(`${BASE_URL}/preferences`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p),
                    keepalive: true,
                    credentials: 'include',
                });
            } catch (_) {}
        }
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isLoggedIn]);

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
        if (order !== null) idbWritePref(K_STACK_ORDER, order);
        scheduleSync({ stackOrder: order });
    }, []);

    const setStackPersist = useCallback((value) => {
        _setStackPersist(value);
        idbWritePref(K_STACK_PERSIST, value);
        scheduleSync({ stackPersist: value });
    }, []);

    const setMrPicks = useCallback((picks) => {
        _setMrPicks(picks);
        if (picks !== null) idbWritePref(K_MR_PICKS, picks);
        scheduleSync({ mrPicks: picks });
    }, []);

    return (
        <UserPreferencesContext.Provider value={{
            columnWidthsDesktop, setColumnWidthsDesktop,
            columnWidthsMobile,  setColumnWidthsMobile,
            stackOrder,          setStackOrder,
            stackPersist, setStackPersist,
            mrPicks,      setMrPicks,
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
