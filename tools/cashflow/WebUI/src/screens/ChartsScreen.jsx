import { useEffect, useCallback } from 'react';
import { useTransactions, useProcessing, useChartFilter } from '../appState';
import { useChartData } from '../customHooks/charts/useChartData';
import { useDetailedChartReveal } from '../customHooks/charts/useDetailedChartReveal';

import ChartWindowSection from '../components/charts/ChartWindowSection';
import StatusBanners from '../components/charts/StatusBanners';
import FilterPane from '../components/dashboard/FilterPane';
import '../styles/chartStyles.css';

export default function ChartsScreen() {
    const { initialLoading, categoryColors } = useTransactions();
    const { categorising, processingStage } = useProcessing();
    const { mobileSelectedCategories, toggleMobileCategory, toggleAllMobileCategories } = useChartFilter();

    const {
        hasData,
        effectiveOrder, isCustomOrder, updateOrder, resetOrder, persist, togglePersist,
        availableCategories, selectedCategories, setSelectedCategories: setChartSelectedCategories,
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
        buildStackDataFromEntries, incomeForEntries,
    } = useChartData();

    const handleRestoreWindow = useCallback(({ mode: savedMode, monthWindowStart: mws, yearWindowStart: yws }) => {
        if (mws) setMonthWindow(mws);
        if (yws != null) setYearWindowStart(yws);
    }, [setMonthWindow, setYearWindowStart]);

    const handleRestoreCategories = useCallback((cats) => {
        setChartSelectedCategories(cats);
    }, [setChartSelectedCategories]);

    const chartReady = useDetailedChartReveal(hasData);

    // NEW - same one-way mirror pattern Dashboard.jsx already uses for
    // contentsSelectedCategories: whenever the shared mobile filter
    // state changes, copy it into this hook's own local chart-filter
    // state, so the chart's rendering reflects it. Never flows the
    // other direction - the chart itself doesn't write back to context.
    useEffect(() => {
        setChartSelectedCategories(new Set(mobileSelectedCategories));
    }, [mobileSelectedCategories, setChartSelectedCategories]);

    return (
        <div className="charts-container">
            <div className="charts-body">
                {/* Sidebar: filter pane — on desktop it's the existing full-width
                    inline block; on mobile (≤700px) it becomes a narrow fixed
                    sidebar matching the transactions screen layout. */}
                <div className="charts-sidebar">
                    <FilterPane
                        availableCategories={availableCategories}
                        contentsSelectedCategories={mobileSelectedCategories}
                        toggleContentsCategory={toggleMobileCategory}
                        toggleAllContentsCategories={toggleAllMobileCategories}
                        categoryColors={categoryColors}
                        effectiveOrder={effectiveOrder}
                        isCustomOrder={isCustomOrder}
                        updateOrder={updateOrder}
                        resetOrder={resetOrder}
                        persist={persist}
                        togglePersist={togglePersist}
                    />
                </div>

                <div className="charts-scroll-content">
                    <StatusBanners initialLoading={initialLoading} processingStage={processingStage} />

                    <ChartWindowSection
                        ready={chartReady}
                        hasData={hasData}
                        monthWindow={monthWindow}
                        yearWindowEntries={yearWindowEntries}
                        monthWindowStart={monthWindowStart}
                        yearWindowStart={yearWindowStart}
                        scrollMonthWindow={scrollMonthWindow}
                        scrollYearWindow={scrollYearWindow}
                        jumpMonthWindowToYear={jumpMonthWindowToYear}
                        canScrollMonthBack={canScrollMonthBack}
                        canScrollMonthForward={canScrollMonthForward}
                        canScrollYearBack={canScrollYearBack}
                        canScrollYearForward={canScrollYearForward}
                        setMonthWindowByIndex={setMonthWindowByIndex}
                        setYearWindowByIndex={setYearWindowByIndex}
                        monthSliderMaxIndex={monthSliderMaxIndex}
                        monthSliderCurrentIndex={monthSliderCurrentIndex}
                        yearSliderMaxIndex={yearSliderMaxIndex}
                        yearSliderCurrentIndex={yearSliderCurrentIndex}
                        monthSliderTrackMax={monthSliderTrackMax}
                        yearSliderTrackMax={yearSliderTrackMax}
                        buildStackDataFromEntries={buildStackDataFromEntries}
                        incomeForEntries={incomeForEntries}
                        monthBounds={monthBounds}
                        yearBounds={yearBounds}
                        selectedCategories={selectedCategories}
                        onRestoreWindow={handleRestoreWindow}
                        onRestoreCategories={handleRestoreCategories}
                    />

                </div>
            </div>
        </div>
    );
}
