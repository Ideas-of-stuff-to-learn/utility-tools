import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getCategories, getUploadCount, getUploadBreakdown, getTransactionHistory, resolveCategories } from '../api';
import { getIdbKey, getIdbUserId } from '../api';
import { useAuth } from './AuthContext';
import { useProcessing } from './ProcessingContext';
import { useUserPreferences } from './UserPreferencesContext';
import { get as idbGet, put as idbPut, getAll as idbGetAll, getMeta, setMeta, isStale } from '../idb/store.js';
import { enqueue } from '../idb/writeQueue.js';

const TransactionsContext = createContext();

const TXN_STORE         = 'transactions';
const CAT_STORE         = 'categories';
const UPLOAD_STORE      = 'upload_stats';
const MAX_AGE_TXN_MS    = 5 * 60 * 1000;   // 5 min
const MAX_AGE_UPLOAD_MS = 2 * 60 * 1000;   // 2 min

// ── IDB helpers ────────────────────────────────────────────────────────────

async function idbReadAllTransactions() {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return [];
    const rows = await idbGetAll(userId, TXN_STORE, cryptoKey);
    return rows.map(r => r.data);
}

async function idbWriteTransactions(txns) {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return;
    for (const t of txns) {
        await idbPut(userId, TXN_STORE, t.id, t, cryptoKey);
    }
    await setMeta(userId, TXN_STORE, { cached_at: Date.now() }, cryptoKey);
}

async function idbReadCategories() {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return null;
    const rows = await idbGetAll(userId, CAT_STORE, cryptoKey);
    return rows.length ? rows.map(r => r.data) : null;
}

async function idbWriteCategories(cats) {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return;
    for (const c of cats) {
        await idbPut(userId, CAT_STORE, c.name, c, cryptoKey);
    }
}

async function idbReadUploadStats() {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return null;
    return idbGet(userId, UPLOAD_STORE, 'singleton', cryptoKey);
}

async function idbWriteUploadStats(stats) {
    const cryptoKey = getIdbKey();
    const userId    = getIdbUserId();
    if (!cryptoKey || !userId) return;
    await idbPut(userId, UPLOAD_STORE, 'singleton', stats, cryptoKey);
    await setMeta(userId, UPLOAD_STORE, { cached_at: Date.now() }, cryptoKey);
}

// ── Context ────────────────────────────────────────────────────────────────

export function TransactionsProvider({ children }) {
    const { isLoggedIn } = useAuth();
    const { startManualReviewFlowIfNeeded } = useProcessing();
    const { mrPicks, setMrPicks } = useUserPreferences();

    // Stable ref so the load effect doesn't re-run when ProcessingContext re-renders mid-load
    const startMRRef = useRef(startManualReviewFlowIfNeeded);
    useEffect(() => { startMRRef.current = startManualReviewFlowIfNeeded; }, [startManualReviewFlowIfNeeded]);

    const [transactions, setTransactions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [uploadCount, setUploadCount] = useState(0);
    const [uploadBreakdown, setUploadBreakdown] = useState({ session_files: [], past_files: [], session_count: 0, past_count: 0 });
    const [initialLoading, setInitialLoading] = useState(true);
    const [allTransactionsLoaded, setAllTransactionsLoaded] = useState(false);
    const [initialLoadError, setInitialLoadError] = useState(null);
    const [loadRetryCount, setLoadRetryCount] = useState(0);

    const categoryNames = useMemo(() => categories.map(c => c.name), [categories]);
    const categoryColors = useMemo(() => Object.fromEntries(categories.map(c => [c.name, c.color])), [categories]);

    const retryInitialLoad = useCallback(() => {
        setLoadRetryCount(c => c + 1);
    }, []);

    const refetchUploadCount = useCallback(() => {
        getUploadCount()
            .then(count => {
                setUploadCount(count);
                idbReadUploadStats().then(cached => {
                    const updated = { ...(cached || {}), count };
                    idbWriteUploadStats(updated);
                });
            })
            .catch(e => console.warn('Failed to load upload count:', e.message));
    }, []);

    const refetchUploadBreakdown = useCallback(() => {
        getUploadBreakdown()
            .then(breakdown => {
                setUploadBreakdown(breakdown);
                idbReadUploadStats().then(cached => {
                    const updated = { ...(cached || {}), breakdown };
                    idbWriteUploadStats(updated);
                });
            })
            .catch(e => console.warn('Failed to load upload breakdown:', e.message));
    }, []);

    useEffect(() => {
        if (!isLoggedIn) return;

        let cancelled = false;
        const controller = new AbortController();
        const { signal } = controller;

        setInitialLoadError(null);
        setAllTransactionsLoaded(false);
        setInitialLoading(true);
        // Do NOT wipe transactions here — IDB data stays visible during background
        // refresh so charts never flash LoadingBarsPlaceholder on returning visits.

        const BATCH_SIZE = 500;

        async function loadInitialData() {
            try {
                // ── Step 1: IDB instant hydration ──────────────────────────
                const [cachedTxns, cachedCats, cachedUpload] = await Promise.all([
                    idbReadAllTransactions(),
                    idbReadCategories(),
                    idbReadUploadStats(),
                ]);

                if (!cancelled && cachedTxns.length > 0) setTransactions(cachedTxns);
                if (!cancelled && cachedCats?.length > 0) setCategories(cachedCats);
                if (!cancelled && cachedUpload) {
                    if (cachedUpload.count != null) setUploadCount(cachedUpload.count);
                    if (cachedUpload.breakdown) setUploadBreakdown(cachedUpload.breakdown);
                    // Can show UI immediately — mark initial loading done if IDB had data
                    if (cachedTxns.length > 0) setInitialLoading(false);
                }

                // ── Step 2: check staleness, fetch from server ─────────────
                const userId    = getIdbUserId();
                const cryptoKey = getIdbKey();

                const [txnMeta, uploadMeta] = await Promise.all([
                    userId && cryptoKey ? getMeta(userId, TXN_STORE, cryptoKey) : null,
                    userId && cryptoKey ? getMeta(userId, UPLOAD_STORE, cryptoKey) : null,
                ]);

                const [cats, count, breakdown] = await Promise.all([
                    getCategories(signal),
                    getUploadCount(signal),
                    getUploadBreakdown(),
                ]);
                if (cancelled) return;

                // Categories — always use server version, check IDB version signal
                setCategories(cats.categories ?? cats);
                idbWriteCategories(cats.categories ?? cats);

                setUploadCount(count);
                setUploadBreakdown(breakdown);
                idbWriteUploadStats({ count, breakdown });

                // Transactions — fetch if stale or IDB was empty
                const txnStale = isStale(txnMeta, { maxAgeMs: MAX_AGE_TXN_MS });
                const needsFetch = cachedTxns.length === 0 || txnStale;

                if (needsFetch) {
                    let offset = 0;
                    let total = null;
                    let firstBatch = true;
                    const freshTxns = [];

                    while (true) {
                        const page = await getTransactionHistory({ offset, limit: BATCH_SIZE }, signal);
                        if (cancelled) return;

                        total = page.total;
                        for (const t of page.transactions) freshTxns.push(t);

                        setTransactions(prev => {
                            const byId = new Map(prev.map(t => [t.id, t]));
                            for (const t of page.transactions) byId.set(t.id, t);
                            return Array.from(byId.values());
                        });

                        if (firstBatch) {
                            setInitialLoading(false);
                            firstBatch = false;
                        }

                        offset += page.transactions.length;
                        if (offset >= total) break;
                    }

                    if (!cancelled) await idbWriteTransactions(freshTxns);
                } else {
                    // IDB was fresh — check if server count matches local
                    // (handles the case where transactions were added from another device)
                    if (cachedTxns.length > 0) setInitialLoading(false);
                }

                if (!cancelled) {
                    setAllTransactionsLoaded(true);

                    let flushedPicks = [];
                    try {
                        if (mrPicks && mrPicks.length > 0) {
                            flushedPicks = mrPicks;
                            setMrPicks(null);
                            await resolveCategories(flushedPicks);
                        }
                    } catch (_) {}

                    setTransactions(current => {
                        const resolvedMap = new Map(
                            flushedPicks.map(p => [`${p.description}|${p.date}|${p.amount}`, p.category])
                        );
                        const corrected = flushedPicks.length > 0
                            ? current.map(t => {
                                const key = `${t.description}|${t.date}|${t.amount}`;
                                return resolvedMap.has(key) ? { ...t, category: resolvedMap.get(key) } : t;
                            })
                            : current;
                        startMRRef.current(corrected);
                        return corrected;
                    });
                }
            } catch (e) {
                if (e.name === 'AbortError') return;
                if (cancelled) return;
                const msg = e.message || '';
                if (msg.includes('starting up')) {
                    setInitialLoadError(msg);
                } else {
                    console.warn('Failed to load initial data:', msg);
                }
            } finally {
                if (!cancelled) setInitialLoading(false);
            }
        }

        loadInitialData();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [isLoggedIn, loadRetryCount]);

    // ── Optimistic transaction update helper ───────────────────────────────
    // Mutations (categorize, delete) use this to update IDB + React state
    // immediately, then enqueue the server call with a rollback.
    const optimisticUpdateTransactions = useCallback((updates, serverFn, rollbackSnapshot) => {
        const cryptoKey = getIdbKey();
        const userId    = getIdbUserId();

        setTransactions(prev => {
            const byId = new Map(prev.map(t => [t.id, t]));
            for (const u of updates) byId.set(u.id, u);
            const next = Array.from(byId.values());
            // Write optimistic state to IDB (best-effort, don't await)
            if (cryptoKey && userId) {
                for (const u of updates) {
                    idbPut(userId, TXN_STORE, u.id, u, cryptoKey).catch(() => {});
                }
            }
            return next;
        });

        enqueue({
            type: 'transaction-update',
            optimisticFn: () => {},  // already applied above
            rollbackFn: () => {
                setTransactions(rollbackSnapshot);
                if (cryptoKey && userId) {
                    for (const t of rollbackSnapshot) {
                        idbPut(userId, TXN_STORE, t.id, t, cryptoKey).catch(() => {});
                    }
                }
            },
            serverFn,
        });
    }, []);

    return (
        <TransactionsContext.Provider value={{
            transactions, setTransactions,
            categories, setCategories,
            categoryNames, categoryColors,
            uploadCount, setUploadCount,
            uploadBreakdown, setUploadBreakdown,
            initialLoading, setInitialLoading,
            allTransactionsLoaded, setAllTransactionsLoaded,
            initialLoadError, setInitialLoadError,
            retryInitialLoad, refetchUploadCount, refetchUploadBreakdown,
            optimisticUpdateTransactions,
        }}>
            {children}
        </TransactionsContext.Provider>
    );
}

export function useTransactions() {
    return useContext(TransactionsContext);
}
