import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { useTransactions } from './TransactionsContext';
import { NEEDS_MANUAL_REVIEW, NOT_YET_CATEGORISED } from '../checkingName';

const ChartFilterContext = createContext();

// Category values that are placeholder/transient — excluded from chart aggregation.
// Must stay in sync with server-side TRANSIENT_CATEGORY_VALUES in API/shared.py.
const EXCLUDED_CATEGORIES = new Set([NEEDS_MANUAL_REVIEW, NOT_YET_CATEGORISED, 'PENDING_LLM']);

// Regex matching the DD/MM/YYYY date format stored in the DB.
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

export function ChartFilterProvider({ children }) {
    const { isLoggedIn } = useAuth();
    const { categoryNames, transactions } = useTransactions();

    // chartDataVersion / bumpChartDataVersion are kept for backward
    // compatibility — they are called from ~10 call sites after uploads
    // and categorization. With chartSummary now derived from transactions
    // via useMemo, bumping the version is no longer needed to trigger a
    // refetch, but keeping it as a no-op avoids touching every call site.
    const [chartDataVersion, setChartDataVersion] = useState(0);
    const bumpChartDataVersion = useCallback(() => {
        setChartDataVersion(t => t + 1);
    }, []);

    const [contentsSelectedCategories, setContentsSelectedCategories] = useState(new Set());
    const seenContentsCategoriesRef = useRef(new Set());

    const [mobileSelectedCategories, setMobileSelectedCategories] = useState(new Set());
    const seenMobileCategoriesRef = useRef(new Set());

    // Derive chart summary directly from transactions — same GROUP BY
    // aggregation that /charts/summary runs server-side, but done
    // client-side so it's instant for returning users (transactions load
    // from IDB) and stays automatically in sync when transactions change
    // after uploads or categorization.
    const chartSummary = useMemo(() => {
        if (!transactions || transactions.length === 0) return { yearly: [], monthly: [] };

        const yearlyMap = new Map();
        const monthlyMap = new Map();

        for (const t of transactions) {
            if (!t.category || EXCLUDED_CATEGORIES.has(t.category)) continue;
            const date = t.date;
            if (!DATE_RE.test(date)) continue;

            const year  = parseInt(date.slice(6, 10), 10);
            const month = parseInt(date.slice(3, 5), 10);
            const amount = Math.abs(parseFloat(t.amount) || 0);

            // yearly aggregate
            const yk = `${year}\x00${t.category}`;
            let yr = yearlyMap.get(yk);
            if (!yr) { yr = { year, category: t.category, total: 0 }; yearlyMap.set(yk, yr); }
            yr.total += amount;

            // monthly aggregate
            const mk = `${year}\x00${month}\x00${t.category}`;
            let mo = monthlyMap.get(mk);
            if (!mo) { mo = { year, month, category: t.category, total: 0 }; monthlyMap.set(mk, mo); }
            mo.total += amount;
        }

        const yearly  = [...yearlyMap.values()].sort((a, b) => a.year - b.year);
        const monthly = [...monthlyMap.values()].sort((a, b) => a.year - b.year || a.month - b.month);
        return { yearly, monthly };
    }, [transactions]);

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
