import { useEffect, useRef } from 'react';
import { useTransactions, useProcessing, useChartFilter } from '../appState';
import { useInitialLoadLogic } from '../customHooks/homescreen/useInitialLoadLogic';
import { useLogout } from '../customHooks/homescreen/useLogout';
import { useFilePicker } from '../customHooks/homescreen/useFilePicker';
import { useFileProcessor } from '../customHooks/homescreen/useFileProcessor';
import { useChartData } from '../customHooks/charts/useChartData';
import { useDetailedChartReveal } from '../customHooks/charts/useDetailedChartReveal';
import { NOT_YET_CATEGORISED } from '../checkingName';
import HomepageInfo from '../components/homepage/homepageInfo';
import ChartWindowSection from '../components/charts/ChartWindowSection';
import FilterPane from '../components/dashboard/FilterPane';
import ActionButtons from '../components/homepage/ActionButtons';
import '../styles/dashboardStyles.css';

export default function DashboardScreen() {
    const { transactions, initialLoadError, retryInitialLoad, allTransactionsLoaded, categoryColors, uploadBreakdown, refetchUploadBreakdown } = useTransactions();
    const { categorising, manualReviewFlow } = useProcessing();
    const { contentsSelectedCategories, toggleContentsCategory, toggleAllContentsCategories } = useChartFilter();
    const { dateRangeInfo, refetchUploadCount } = useInitialLoadLogic();
    const { handleLogout } = useLogout();
    const { pickFiles, selectedFiles, setSelectedFiles, status, setStatus, error, setError } = useFilePicker();
    const { processFiles, loading, progress, duplicateNotice, clearDuplicateNotice } = useFileProcessor(setStatus, setError, selectedFiles);
    const notYetCategorisedCount = transactions.filter(t => t.category === NOT_YET_CATEGORISED).length;

    useEffect(() => {
        if (!manualReviewFlow) setSelectedFiles([]);
    }, [manualReviewFlow, setSelectedFiles]);

    async function handleCategorisePress() {
        await processFiles();
        setSelectedFiles([]);
        refetchUploadCount();
        refetchUploadBreakdown();
    }

    const {
        hasData, effectiveOrder, updateOrder, resetOrder, persist, togglePersist, isCustomOrder,
        availableCategories, setSelectedCategories: setChartSelectedCategories,
        monthBounds, yearBounds,
        monthWindow, yearWindowEntries,
        scrollMonthWindow, scrollYearWindow, jumpMonthWindowToYear,
        canScrollMonthBack, canScrollMonthForward,
        canScrollYearBack, canScrollYearForward,
        setMonthWindowByIndex, setYearWindowByIndex,
        monthSliderMaxIndex, monthSliderCurrentIndex,
        yearSliderMaxIndex, yearSliderCurrentIndex,
        monthSliderTrackMax, yearSliderTrackMax,
        buildStackDataFromEntries, incomeForEntries, selectedSegment,
    } = useChartData();
    const chartReady = useDetailedChartReveal(hasData);
    const chartAreaRef = useRef(null);

    // scrollTop removed — chart area uses overflow:hidden and a windowed
    // view; programmatic scroll was pushing the title off the top edge.

    useEffect(() => {
        setChartSelectedCategories(new Set(contentsSelectedCategories));
    }, [contentsSelectedCategories, setChartSelectedCategories]);

    return (
        <div className="dashboard-flex">
            <div className="dashboard-home-box">
                <HomepageInfo dateRangeInfo={dateRangeInfo} uploadBreakdown={uploadBreakdown} showTitle={false} />
                {initialLoadError && (
                    <div className="banner">
                        <p className="banner-text">{initialLoadError}</p>
                        <button className="btn" onClick={retryInitialLoad}>Retry</button>
                    </div>
                )}
                <ActionButtons
                    pickFiles={pickFiles}
                    selectedFiles={selectedFiles}
                    loading={loading}
                    categorising={categorising}
                    status={status}
                    error={error}
                    progress={progress}
                    handleCategorisePress={handleCategorisePress}
                    notYetCategorisedCount={notYetCategorisedCount}
                    allTransactionsLoaded={allTransactionsLoaded}
                    handleLogout={handleLogout}
                    duplicateNotice={duplicateNotice}
                    onDismissDuplicateNotice={clearDuplicateNotice}
                />
            </div>

            <div className="dashboard-main">
                <div className="dashboard-charts-box">
                    <div className="dashboard-chart-area" ref={chartAreaRef}>
                        <ChartWindowSection
                            ready={chartReady}
                            hasData={hasData}
                            monthWindow={monthWindow}
                            yearWindowEntries={yearWindowEntries}
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

            <FilterPane
                availableCategories={availableCategories}
                contentsSelectedCategories={contentsSelectedCategories}
                toggleContentsCategory={toggleContentsCategory}
                toggleAllContentsCategories={toggleAllContentsCategories}
                effectiveOrder={effectiveOrder}
                isCustomOrder={isCustomOrder}
                categoryColors={categoryColors}
                updateOrder={updateOrder}
                resetOrder={resetOrder}
                persist={persist}
                togglePersist={togglePersist}
            />
        </div>
    );
}