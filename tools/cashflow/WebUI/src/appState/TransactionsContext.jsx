import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    getCategories, getUploadCount, getUploadBreakdown, getTransactionHistory,
    resolveCategories, getSyncState, getIdbKey, getIdbUserId, isAuthFailure,
} from '../api';
import { useAuth } from './AuthContext';
import { useProcessing } from './ProcessingContext';
import { useUserPreferences } from './UserPreferencesContext';
import { loadBootSnapshot, saveBootSnapshot } from '../idb/bootSnapshot';
import { registerFlusher } from '../idb/persistence';
import { addReloadGuard } from '../idb/reloadGuard';

const TransactionsContext = createContext();

const FIRST_PAGE_SIZE         = 500;
const BULK_PAGE_SIZE          = 2000;              // backend maximum per page
const SNAPSHOT_SAVE_DELAY_MS  = 600;
const REVALIDATE_EVERY_MS     = 5 * 60 * 1000;
const REVALIDATE_MIN_GAP_MS   = 60 * 1000;
const BREAKDOWN_MAX_AGE_MS    = 6 * 60 * 60 * 1000; // session/past split is time-based
const NO_SYNC_ENDPOINT_TTL_MS = 30 * 60 * 1000;     // only used if /sync/state is unavailable
const COLD_RETRY_DELAYS_MS    = [1000, 2000, 4000, 8000, 15000];

const EMPTY_BREAKDOWN = { session_files: [], past_files: [], session_count: 0, past_count: 0 };

async function fetchRemainingTransactions(firstPage, signal) {
    const byId = new Map(firstPage.transactions.map(t => [t.id, t]));
    let offset = firstPage.transactions.length;
    while (offset < firstPage.total) {
        const page = await getTransactionHistory({ offset, limit: BULK_PAGE_SIZE }, signal);
        if (page.transactions.length === 0) break;
        for (const t of page.transactions) byId.set(t.id, t);
        offset += page.transactions.length;
    }
    return Array.from(byId.values());
}

async function fetchAllTransactions(signal) {
    const first = await getTransactionHistory({ offset: 0, limit: BULK_PAGE_SIZE }, signal);
    return fetchRemainingTransactions(first, signal);
}

// Data lifecycle:
//  1. Boot: decrypt ONE IDB snapshot and paint everything in a single render.
//     Cold start (no snapshot): fetch from the server, first page painted early.
//  2. Background revalidation (boot, tab focus, every 5 min): compare the
//     server fingerprint (/sync/state) with the one stored alongside the
//     snapshot; refetch only what changed and swap it in atomically.
//  3. Any change to the data re-saves the snapshot (debounced), so uploads,
//     recategorisations and deletes survive the next visit.
export function TransactionsProvider({ children }) {
    const { idbReady } = useAuth();
    const { categorising, processingStage, manualReviewFlow, startManualReviewFlowIfNeeded } = useProcessing();
    const { mrPicks, setMrPicks, localPrefsReady } = useUserPreferences();

    const [transactions, _setTransactions] = useState([]);
    const [categories, _setCategories] = useState([]);
    const [uploadCount, setUploadCount] = useState(0);
    const [uploadBreakdown, setUploadBreakdown] = useState(EMPTY_BREAKDOWN);
    const [initialLoading, setInitialLoading] = useState(true);
    const [allTransactionsLoaded, setAllTransactionsLoaded] = useState(false);
    const [initialLoadError, setInitialLoadError] = useState(null);
    const [loadRetryCount, setLoadRetryCount] = useState(0);

    const syncRef        = useRef(null);  // server fingerprint the in-memory data matches
    const savedAtRef     = useRef(0);
    const breakdownAtRef = useRef(0);
    const lastCheckRef   = useRef(0);
    const checkingRef    = useRef(false);
    const coldAttemptRef = useRef(0);
    const skipSaveRef    = useRef(false);
    // Bumped by every write that doesn't come from the sync pipeline, so an
    // in-flight background refetch can tell its result is already outdated.
    const localEditRef   = useRef(0);
    const busyRef        = useRef(false);
    const transactionsRef = useRef(transactions);
    const startMRRef     = useRef(startManualReviewFlowIfNeeded);

    useEffect(() => { transactionsRef.current = transactions; }, [transactions]);
    useEffect(() => { startMRRef.current = startManualReviewFlowIfNeeded; }, [startManualReviewFlowIfNeeded]);
    useEffect(() => {
        // processingStage is left at 'done' after an upload, which is not busy.
        const processing = processingStage === 'parsing' || processingStage === 'checkingCache' || processingStage === 'waitingForLLM';
        busyRef.current = categorising || processing || !!manualReviewFlow;
    }, [categorising, processingStage, manualReviewFlow]);
    // A deploy must never reload the page in the middle of an upload,
    // categorisation or manual review (see shared/vite-stale-build-guard.js).
    useEffect(() => addReloadGuard(() => !busyRef.current), []);

    const setTransactions = useCallback((update) => {
        localEditRef.current++;
        _setTransactions(update);
    }, []);

    const setCategories = useCallback((update) => {
        localEditRef.current++;
        _setCategories(update);
    }, []);

    const categoryNames = useMemo(() => categories.map(c => c.name), [categories]);
    const categoryColors = useMemo(() => Object.fromEntries(categories.map(c => [c.name, c.color])), [categories]);

    const retryInitialLoad = useCallback(() => setLoadRetryCount(c => c + 1), []);

    const refetchUploadCount = useCallback(() => {
        getUploadCount()
            .then(setUploadCount)
            .catch(e => console.warn('Failed to load upload count:', e.message));
    }, []);

    const refetchUploadBreakdown = useCallback(() => {
        getUploadBreakdown()
            .then(breakdown => {
                breakdownAtRef.current = Date.now();
                setUploadBreakdown(breakdown);
            })
            .catch(e => console.warn('Failed to load upload breakdown:', e.message));
    }, []);

    // ── 1. Boot ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!idbReady) return;
        let cancelled = false;
        let retryTimer = null;
        const controller = new AbortController();
        const { signal } = controller;

        async function boot() {
            const userId = getIdbUserId();
            const cryptoKey = getIdbKey();
            const snap = userId && cryptoKey ? await loadBootSnapshot(userId, cryptoKey) : null;
            if (cancelled) return;

            if (snap) {
                syncRef.current = snap.sync ?? null;
                savedAtRef.current = snap.savedAt ?? 0;
                breakdownAtRef.current = snap.uploadBreakdownAt ?? 0;
                skipSaveRef.current = true;
                _setTransactions(snap.transactions ?? []);
                _setCategories(snap.categories ?? []);
                setUploadCount(snap.uploadCount ?? 0);
                setUploadBreakdown(snap.uploadBreakdown ?? EMPTY_BREAKDOWN);
                setInitialLoading(false);
                setAllTransactionsLoaded(true);
                return;
            }

            try {
                // Fingerprint first: if data changes mid-fetch, the stored
                // fingerprint is older than the data and the next check refetches.
                const sync = await getSyncState(signal).catch(() => null);
                const uploadsPromise = Promise.all([getUploadCount(signal), getUploadBreakdown()]).catch(() => null);
                const [cats, firstPage] = await Promise.all([
                    getCategories(signal),
                    getTransactionHistory({ offset: 0, limit: FIRST_PAGE_SIZE }, signal),
                ]);
                if (cancelled) return;
                _setCategories(cats);
                _setTransactions(firstPage.transactions);
                setInitialLoading(false);

                const all = await fetchRemainingTransactions(firstPage, signal);
                const uploads = await uploadsPromise;
                if (cancelled) return;
                syncRef.current = sync;
                lastCheckRef.current = Date.now();
                if (all.length !== firstPage.transactions.length) _setTransactions(all);
                if (uploads) {
                    breakdownAtRef.current = Date.now();
                    setUploadCount(uploads[0]);
                    setUploadBreakdown(uploads[1]);
                }
                coldAttemptRef.current = 0;
                setAllTransactionsLoaded(true);
            } catch (e) {
                if (cancelled || isAuthFailure(e)) return;
                console.warn('Initial load failed, retrying:', e.message);
                const n = coldAttemptRef.current++;
                retryTimer = setTimeout(
                    () => setLoadRetryCount(c => c + 1),
                    COLD_RETRY_DELAYS_MS[Math.min(n, COLD_RETRY_DELAYS_MS.length - 1)],
                );
            }
        }

        boot();
        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            controller.abort();
        };
    }, [idbReady, loadRetryCount]);

    // ── Boot-time manual review: flush saved picks, then open the review
    // flow for anything still unresolved. Once per page load.
    const mrBootDoneRef = useRef(false);
    useEffect(() => {
        if (!allTransactionsLoaded || !localPrefsReady || mrBootDoneRef.current) return;
        mrBootDoneRef.current = true;
        (async () => {
            const picks = mrPicks?.length ? mrPicks : [];
            let current = transactionsRef.current;
            if (picks.length) {
                setMrPicks(null);
                try { await resolveCategories(picks); } catch {}
                const resolved = new Map(picks.map(p => [`${p.description}|${p.date}|${p.amount}`, p.category]));
                current = transactionsRef.current.map(t => {
                    const key = `${t.description}|${t.date}|${t.amount}`;
                    return resolved.has(key) ? { ...t, category: resolved.get(key) } : t;
                });
                setTransactions(current);
            }
            startMRRef.current(current);
        })();
    }, [allTransactionsLoaded, localPrefsReady, mrPicks, setMrPicks, setTransactions]);

    // ── 2. Background revalidation ─────────────────────────────────────────
    const revalidate = useCallback(async () => {
        if (checkingRef.current || busyRef.current) return;
        if (Date.now() - lastCheckRef.current < REVALIDATE_MIN_GAP_MS) return;
        checkingRef.current = true;
        lastCheckRef.current = Date.now();
        const editStamp = localEditRef.current;
        try {
            let server = null;
            try { server = await getSyncState(); } catch (e) { if (e.status !== 404) throw e; }

            const known = syncRef.current;
            const changed = (field) => server
                ? known?.[field] !== server[field]
                : Date.now() - savedAtRef.current > NO_SYNC_ENDPOINT_TTL_MS;
            const needTxns = changed('transactions');
            const needCats = changed('categories');
            const needUploads = changed('uploads') || Date.now() - breakdownAtRef.current > BREAKDOWN_MAX_AGE_MS;
            if (!needTxns && !needCats && !needUploads) return;

            const [txns, cats, uploads] = await Promise.all([
                needTxns ? fetchAllTransactions() : null,
                needCats ? getCategories() : null,
                needUploads ? Promise.all([getUploadCount(), getUploadBreakdown()]) : null,
            ]);
            // A local edit or an upload/review started while we were fetching:
            // its state is newer than what we fetched. Try again next tick.
            if (localEditRef.current !== editStamp || busyRef.current) {
                lastCheckRef.current = 0;
                return;
            }
            if (server) syncRef.current = server;
            if (txns) _setTransactions(txns);
            if (cats) _setCategories(cats);
            if (uploads) {
                breakdownAtRef.current = Date.now();
                setUploadCount(uploads[0]);
                setUploadBreakdown(uploads[1]);
            }
        } catch (e) {
            if (!isAuthFailure(e)) console.warn('[sync] background check failed:', e.message);
        } finally {
            checkingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!allTransactionsLoaded) return;
        revalidate();
        const onWake = () => { if (document.visibilityState === 'visible') revalidate(); };
        const timer = setInterval(onWake, REVALIDATE_EVERY_MS);
        document.addEventListener('visibilitychange', onWake);
        window.addEventListener('focus', onWake);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onWake);
            window.removeEventListener('focus', onWake);
        };
    }, [allTransactionsLoaded, revalidate]);

    // ── 3. Persist the snapshot whenever the data changes ─────────────────
    const pendingSaveRef = useRef(null);

    const saveSnapshotNow = useCallback(async () => {
        const job = pendingSaveRef.current;
        if (!job) return;
        pendingSaveRef.current = null;
        clearTimeout(job.timer);
        const userId = getIdbUserId();
        const cryptoKey = getIdbKey();
        if (!userId || !cryptoKey) return;
        const savedAt = Date.now();
        if (await saveBootSnapshot(userId, cryptoKey, { ...job.data, savedAt })) savedAtRef.current = savedAt;
    }, []);

    useEffect(() => {
        if (!allTransactionsLoaded || !idbReady) return;
        if (skipSaveRef.current) { skipSaveRef.current = false; return; }
        const data = {
            transactions, categories, uploadCount, uploadBreakdown,
            uploadBreakdownAt: breakdownAtRef.current,
            sync: syncRef.current,
        };
        if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timer);
        pendingSaveRef.current = { data, timer: setTimeout(saveSnapshotNow, SNAPSHOT_SAVE_DELAY_MS) };
    }, [transactions, categories, uploadCount, uploadBreakdown, allTransactionsLoaded, idbReady, saveSnapshotNow]);

    useEffect(() => registerFlusher(saveSnapshotNow), [saveSnapshotNow]);

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
        }}>
            {children}
        </TransactionsContext.Provider>
    );
}

export function useTransactions() {
    return useContext(TransactionsContext);
}
