import { useTransactions, useProcessing, useChartFilter } from '../appState';
import { useChartData } from '../customHooks/charts/useChartData';
import { useDetailedChartReveal } from '../customHooks/charts/useDetailedChartReveal';

import ChartWindowSection from '../components/charts/ChartWindowSection';
import StatusBanners from '../components/charts/StatusBanners';
import FilterPane from '../components/dashboard/FilterPane';
import '../styles/chartStyles.css';

export default function ChartsScreen() {
    const { initialLoading, categoryColors } = useTransactions();
    const { processingStage } = useProcessing();
    const { mobileSelectedCategories, toggleMobileCategory, toggleAllMobileCategories } = useChartFilter();

    const {
        hasData,
        effectiveOrder, isCustomOrder, updateOrder, resetOrder, persist, togglePersist,
        availableCategories,
        monthBounds, yearBounds,
        monthWindow, yearWindowEntries,
        monthWindowStart, yearWindowStart,
        scrollMonthWindow, scrollYearWindow, jumpMonthWindowToYear,
        canScrollMonthBack, canScrollMonthForward,
        canScrollYearBack, canScrollYearForward,
        setMonthWindowByIndex, setYearWindowByIndex,
        monthSliderMaxIndex, monthSliderCurrentIndex,
        yearSliderMaxIndex, yearSliderCurrentIndex,
        monthSliderTrackMax, yearSliderTrackMax,
        buildStackDataFromEntries, incomeForEntries,
    } = useChartData(mobileSelectedCategories);

    const chartReady = useDetailedChartReveal(hasData);

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
                    />

                </div>
            </div>
        </div>
    );
}
