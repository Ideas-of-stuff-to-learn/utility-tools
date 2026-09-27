import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useTransactions } from './TransactionsContext';
import { NEEDS_MANUAL_REVIEW, NOT_YET_CATEGORISED } from '../checkingName';
import { getIdbKey, getIdbUserId } from '../api';
import { get as idbGet, put as idbPut } from '../idb/store';

const ChartFilterContext = createContext();

// Must stay in sync with TRANSIENT_CATEGORY_VALUES in API/shared.py
const EXCLUDED_CATEGORIES = new Set([NEEDS_MANUAL_REVIEW, NOT_YET_CATEGORISED, 'PENDING_LLM']);
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

// Aggregates raw transactions into the {yearly, monthly} shape the chart
// consumes — same GROUP BY the server-side /charts/summary used to do.
function computeChartSummary(transactions) {
    const yearlyMap  = new Map();
    const monthlyMap = new Map();

    for (const t of transactions) {
        if (!t.category || EXCLUDED_CATEGORIES.has(t.category)) continue;
        const date = t.date;
        if (!DATE_RE.test(date)) continue;

        const year   = parseInt(date.slice(6, 10), 10);
        const month  = parseInt(date.slice(3, 5),  10);
        const amount = Math.abs(parseFloat(t.amount) || 0);

        const yk = `${year}\x00${t.category}`;
        let yr = yearlyMap.get(yk);
        if (!yr) { yr = { year, category: t.category, total: 0 }; yearlyMap.set(yk, yr); }
        yr.total += amount;

        const mk = `${year}\x00${month}\x00${t.category}`;
        let mo = monthlyMap.get(mk);
        if (!mo) { mo = { year, month, category: t.category, total: 0 }; monthlyMap.set(mk, mo); }
        mo.total += amount;
    }

    return {
        yearly:  [...yearlyMap.values()].sort((a, b) => a.year - b.year),
        monthly: [...monthlyMap.values()].sort((a, b) => a.year - b.year || a.month - b.month),
    };
}

export function ChartFilterProvider({ children }) {
    const { isLoggedIn, idbReady } = useAuth();
    const { categoryNames, transactions } = useTransactions();

    const [chartSummary, setChartSummary] = useState({ yearly: [], monthly: [] });

    // chartDataVersion / bumpChartDataVersion kept for call-site compatibility —
    // called from ~10 places after uploads and categorization. Chart now updates
    // automatically when transactions state changes so bumping is a no-op.
    const [chartDataVersion, setChartDataVersion] = useState(0);
    const bumpChartDataVersion = useCallback(() => setChartDataVersion(t => t + 1), []);

    const [contentsSelectedCategories, setContentsSelectedCategories] = useState(new Set());
    const seenContentsCategoriesRef = useRef(new Set());

    const [mobileSelectedCategories, setMobileSelectedCategories] = useState(new Set());
    const seenMobileCategoriesRef = useRef(new Set());

    // ── Phase 1: instant IDB warm-start ────────────────────────────────────
    // Reads ONE pre-computed chart_summary blob (single decrypt, ~2ms) so
    // hasData=true before transactions finish loading from IDB.
    // Gated on idbReady (not isLoggedIn) — isLoggedIn can be true from
    // the sessionStorage hint before getMe() resolves and sets the crypto
    // key, which would cause getIdbKey() to return null and bail silently.
    useEffect(() => {
        if (!idbReady) return;
        const cryptoKey = getIdbKey();
        const userId    = getIdbUserId();
        if (!cryptoKey || !userId) return;

        idbGet(userId, 'preferences', 'chart_summary', cryptoKey)
            .then(cached => {
                if (cached?.yearly?.length > 0) setChartSummary(cached);
            })
            .catch(() => {});
    }, [idbReady]);

    // ── Phase 2: recompute from full transactions ───────────────────────────
    // Runs once transactions are in state (from IDB or server). Computes fresh
    // aggregates and writes the result back to IDB so the next phase-1 read
    // is always current.
    useEffect(() => {
        if (!transactions || transactions.length === 0) return;
        const computed = computeChartSummary(transactions);
        if (computed.yearly.length === 0) return;

        setChartSummary(computed);

        const cryptoKey = getIdbKey();
        const userId    = getIdbUserId();
        if (cryptoKey && userId) {
            idbPut(userId, 'preferences', 'chart_summary', computed, cryptoKey).catch(() => {});
        }
    }, [transactions]);

    // ── Reset on logout ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!isLoggedIn) {
            setChartSummary({ yearly: [], monthly: [] });
        }
    }, [isLoggedIn]);

    const toggleContentsCategory = useCallback((cat) => {
        setContentsSelectedCategories(prev => {
            const next = new Set(prev);
            next.has(cat) ? next.delete(cat) : next.add(cat);
            return next;
        });
    }, []);

    const toggleAllContentsCategories = useCallback((allCategoryNames) => {
        setContentsSelectedCategories(prev =>
            prev.size >= allCategoryNames.length ? new Set() : new Set(allCategoryNames)
        );
    }, []);

    const toggleMobileCategory = useCallback((cat) => {
        setMobileSelectedCategories(prev => {
            const next = new Set(prev);
            next.has(cat) ? next.delete(cat) : next.add(cat);
            return next;
        });
    }, []);

    const toggleAllMobileCategories = useCallback((allCategoryNames) => {
        setMobileSelectedCategories(prev =>
            prev.size >= allCategoryNames.length ? new Set() : new Set(allCategoryNames)
        );
    }, []);

    // Auto-select newly arriving category names in contents filter
    useEffect(() => {
        const newlyArrived = categoryNames.filter(name => !seenContentsCategoriesRef.current.has(name));
        if (newlyArrived.length > 0) {
            setContentsSelectedCategories(prev => {
                const next = new Set(prev);
                newlyArrived.forEach(name => next.add(name));
                return next;
            });
            newlyArrived.forEach(name => seenContentsCategoriesRef.current.add(name));
        }
    }, [categoryNames]);

    // Auto-select newly arriving category names in mobile filter
    useEffect(() => {
        const newlyArrived = categoryNames.filter(name => !seenMobileCategoriesRef.current.has(name));
        if (newlyArrived.length > 0) {
            setMobileSelectedCategories(prev => {
                const next = new Set(prev);
                newlyArrived.forEach(name => next.add(name));
                return next;
            });
            newlyArrived.forEach(name => seenMobileCategoriesRef.current.add(name));
        }
    }, [categoryNames]);

    return (
        <ChartFilterContext.Provider value={{
            chartSummary,
            chartDataVersion, bumpChartDataVersion,
            contentsSelectedCategories,
            toggleContentsCategory,
            toggleAllContentsCategories,
            mobileSelectedCategories,
            toggleMobileCategory,
            toggleAllMobileCategories,
        }}>
            {children}
        </ChartFilterContext.Provider>
    );
}

export function useChartFilter() {
    return useContext(ChartFilterContext);
}
