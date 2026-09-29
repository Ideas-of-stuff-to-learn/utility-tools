import { createContext, useContext, useState, useCallback, useLayoutEffect, useRef, useMemo } from 'react';
import { useTransactions } from './TransactionsContext';
import { NEEDS_MANUAL_REVIEW, NOT_YET_CATEGORISED } from '../checkingName';

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
    const { categoryNames, transactions } = useTransactions();

    // Derived synchronously in the same render the transactions arrive in —
    // the boot snapshot hands over transactions + categories together, so
    // the chart's first frame is already the real chart.
    const chartSummary = useMemo(() => computeChartSummary(transactions), [transactions]);

    // chartDataVersion / bumpChartDataVersion kept for call-site compatibility —
    // called from ~10 places after uploads and categorization. Chart now updates
    // automatically when transactions state changes so bumping is a no-op.
    const [chartDataVersion, setChartDataVersion] = useState(0);
    const bumpChartDataVersion = useCallback(() => setChartDataVersion(t => t + 1), []);

    const [contentsSelectedCategories, setContentsSelectedCategories] = useState(new Set());
    const seenContentsCategoriesRef = useRef(new Set());

    const [mobileSelectedCategories, setMobileSelectedCategories] = useState(new Set());
    const seenMobileCategoriesRef = useRef(new Set());

    // Chart view state lives here (not in the chart components) so it
    // survives Dashboard ↔ Charts remounts when the viewport crosses the
    // mobile breakpoint. null window start = "follow the latest data".
    const [chartMode, setChartMode] = useState('month');
    const [monthWindowStartOverride, setMonthWindowStartOverride] = useState(null);
    const [yearWindowStartOverride, setYearWindowStartOverride] = useState(null);

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

    // Auto-select newly arriving category names. Layout effects so the
    // selection lands before paint — otherwise the chart's first frame
    // draws every segment at zero height.
    useLayoutEffect(() => {
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

    useLayoutEffect(() => {
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
            chartMode, setChartMode,
            monthWindowStartOverride, setMonthWindowStartOverride,
            yearWindowStartOverride, setYearWindowStartOverride,
        }}>
            {children}
        </ChartFilterContext.Provider>
    );
}

export function useChartFilter() {
    return useContext(ChartFilterContext);
}
