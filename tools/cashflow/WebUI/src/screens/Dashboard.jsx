import { useRef, useEffect } from 'react';
import { useTransactions, useProcessing, useChartFilter } from '../appState';
import { useUploadSession } from '../appState/UploadSessionContext';
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
import DashboardLogoutButton from '../components/homepage/DashboardLogoutButton';
import '../styles/shared.css';
import '../styles/dashboardStyles.css';

export default function DashboardScreen() {
    const { transactions, allTransactionsLoaded, categoryColors, uploadBreakdown } = useTransactions();
    const { categorising } = useProcessing();
    const { contentsSelectedCategories, toggleContentsCategory, toggleAllContentsCategories } = useChartFilter();
    const { dateRangeInfo } = useInitialLoadLogic();
    const { handleLogout } = useLogout();
    const { pickFiles, selectedFiles, status, error } = useFilePicker();
    const { categoriseSelected, loading, progress, duplicateNotice, clearDuplicateNotice } = useFileProcessor();
    const { selectedFiles: ctxFiles, loading: ctxLoading, error: ctxError } = useUploadSession();
    const hasUploadContent = ctxFiles.length > 0 || ctxLoading || !!ctxError;
    const notYetCategorisedCount = transactions.filter(t => t.category === NOT_YET_CATEGORISED).length;

    useEffect(() => {
        const shell = document.querySelector('.app-shell-locked');
        if (!shell) return;
        if (hasUploadContent) {
            shell.classList.add('allow-scroll');
        } else {
            shell.classList.remove('allow-scroll');
        }
        return () => shell.classList.remove('allow-scroll');
    }, [hasUploadContent]);


    const {
        hasData, effectiveOrder, updateOrder, resetOrder, persist, togglePersist, isCustomOrder,
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
    } = useChartData(contentsSelectedCategories);

    const chartReady = useDetailedChartReveal(hasData);
    const chartAreaRef = useRef(null);

    // scrollTop removed — chart area uses overflow:hidden and a windowed
    // view; programmatic scroll was pushing the title off the top edge.

    return (
        <div className="dashboard-flex">
            <div className="dashboard-home-box">
                <div className={`dashboard-home-scroll${hasUploadContent ? ' has-upload-content' : ''}`}>
                    <HomepageInfo dateRangeInfo={dateRangeInfo} uploadBreakdown={uploadBreakdown} showTitle={false} />
                    <ActionButtons
                        pickFiles={pickFiles}
                        selectedFiles={selectedFiles}
                        loading={loading}
                        categorising={categorising}
                        status={status}
                        error={error}
                        progress={progress}
                        handleCategorisePress={categoriseSelected}
                        notYetCategorisedCount={notYetCategorisedCount}
                        allTransactionsLoaded={allTransactionsLoaded}
                        handleLogout={handleLogout}
                        hideLogout={true}
                        duplicateNotice={duplicateNotice}
                        onDismissDuplicateNotice={clearDuplicateNotice}
                    />
                </div>
                <div className="dashboard-home-footer">
                    <DashboardLogoutButton handleLogout={handleLogout} />
                </div>
            </div>

            <div className="dashboard-main">
                <div className="dashboard-charts-box">
                    <div className="dashboard-chart-area" ref={chartAreaRef}>
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