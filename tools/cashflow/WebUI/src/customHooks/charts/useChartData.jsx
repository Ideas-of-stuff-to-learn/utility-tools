import { useState, useMemo, useCallback } from 'react';
import { useStackOrder } from './useStackOrder';
import { useChartWindows } from './useChartWindows';
import { useTransactions, useChartFilter } from '../../appState';
import { toggleItem, selectAll } from '../../utils/charts/chartUtils';
import { buildStackDataFromEntries, buildIncomeDataFromEntries } from '../../utils/charts/buildStackData';

const NO_SELECTION = new Set();

// selectedCategories comes straight from the caller's filter set in
// ChartFilterContext (desktop vs mobile) — no local copy, so a remounted
// chart's first frame already has the right categories visible.
export function useChartData(selectedCategories = NO_SELECTION) {
    const { categoryNames, categoryColors } = useTransactions();
    const { chartSummary } = useChartFilter();

    const summary = chartSummary;
    const {
        effectiveOrder, stackOrder, updateOrder, resetOrder, persist, togglePersist, isCustomOrder,
    } = useStackOrder(categoryNames);

    const [selectedSegment, setSelectedSegment] = useState(null);

    const availableCategories = useMemo(
        () => categoryNames.filter(c => c !== 'Income'),
        [categoryNames]
    );

    const handleSegmentPress = useCallback(({ year, month, category, value }) => {
        setSelectedSegment({ year, month, category, value });
    }, []);

    const hasData = summary.yearly.length > 0;

    const {
        monthBounds, yearBounds,
        monthWindow, yearWindowEntries,
        monthWindowStart, yearWindowStart,
        scrollMonthWindow, scrollYearWindow, jumpMonthWindowToYear,
        canScrollMonthBack, canScrollMonthForward,
        canScrollYearBack, canScrollYearForward,
        setMonthWindowByIndex, setYearWindowByIndex,
        setMonthWindow, setYearWindowStart,
        monthSliderMaxIndex, monthSliderCurrentIndex,
        yearSliderMaxIndex, yearSliderCurrentIndex,
        monthSliderTrackMax, yearSliderTrackMax,
    } = useChartWindows(summary.monthly, summary.yearly);

    const monthWindowSpansMultipleYears = useMemo(() => {
        const years = new Set(monthWindow.map(m => m.year));
        return years.size > 1;
    }, [monthWindow]);

    const buildStackData = useCallback((entries, extraOnPress) => {
        return buildStackDataFromEntries(entries, extraOnPress, {
            categoryNames,
            categoryColors,
            selectedCategories,
            stackOrder: effectiveOrder,
            onSegmentPress: handleSegmentPress,
            spansMultipleYears: monthWindowSpansMultipleYears,
        });
    }, [categoryNames, categoryColors, selectedCategories, effectiveOrder, handleSegmentPress, monthWindowSpansMultipleYears]);

    const allTimeChartData2 = useMemo(() => {
        const totals = {};
        summary.yearly.forEach(r => {
            if (r.category === 'Income') return;
            totals[r.category] = (totals[r.category] || 0) + r.total;
        });
        return Object.entries(totals).map(([label, value]) => ({ label, value }));
    }, [summary.yearly]);

    return {
        hasData,
        effectiveOrder, isCustomOrder, updateOrder, resetOrder, persist, togglePersist,
        availableCategories, selectedCategories,
        toggleItem, selectAll,
        allTimeChartData2,
        selectedSegment,

        monthBounds, yearBounds,
        monthWindow, yearWindowEntries,
        monthWindowStart, yearWindowStart,
        scrollMonthWindow, scrollYearWindow, jumpMonthWindowToYear,
        canScrollMonthBack, canScrollMonthForward,
        canScrollYearBack, canScrollYearForward,
        setMonthWindowByIndex, setYearWindowByIndex,
        setMonthWindow, setYearWindowStart,
        monthSliderMaxIndex, monthSliderCurrentIndex,
        yearSliderMaxIndex, yearSliderCurrentIndex,
        monthSliderTrackMax, yearSliderTrackMax,
        buildStackDataFromEntries: buildStackData,
        incomeForEntries: buildIncomeDataFromEntries,
    };
}