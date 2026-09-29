import { useState, useMemo } from 'react';
import '../../styles/chartStyles.css';
import SpendingStackChart from './StackChartCanvas';
import LoadingBarsPlaceholder from '../loading/LoadingBarsPlaceholder';
import ChartWindowToggle from './chartWindowsToggle';
import SegmentPopupFixed from './SegmentPopupFixed';
import IncomeLegend from './IncomeLegend';
import RangeWindowSlider from './RangeWindowSlider';
import { useDataReadiness } from '../../customHooks/charts/useDataReadiness';
import { useSegmentPopup } from '../../customHooks/charts/useSegmentPopup';
import { useTransactions, useProcessing } from '../../appState';
import { POPUP_VARIANT, POPUP_STATES } from '../../config/popupChartConfig';

export default function ChartWindowSection({
    ready, hasData,
    monthWindow, yearWindowEntries,
    monthWindowStart, yearWindowStart,
    scrollMonthWindow, scrollYearWindow, jumpMonthWindowToYear,
    canScrollMonthBack, canScrollMonthForward,
    canScrollYearBack, canScrollYearForward,
    setMonthWindowByIndex, setYearWindowByIndex,
    monthSliderCurrentIndex, yearSliderCurrentIndex,
    monthSliderTrackMax, yearSliderTrackMax,
    monthBounds, yearBounds,
    buildStackDataFromEntries,
    incomeForEntries,
    // IDB restore callbacks — optional, provided by parent screens
    onRestoreWindow, onRestoreCategories,
    selectedCategories,
}) {
    const [heightScale, setHeightScale] = useState(1);
    const [mode, setMode] = useState('month');
    const { initialLoading } = useTransactions();
    const { categorising, processingStage } = useProcessing();
    const { isLoading } = useDataReadiness(hasData, { initialLoading, categorising, processingStage });

    const { activeSegment, showSegment, handleChartMouseLeave, handleChartBackgroundClick } = useSegmentPopup();

    function handleSegmentInteract(segmentData, key, cursorPos) {
        showSegment({ ...segmentData, _positionKey: key, _cursorPos: cursorPos });
    }

    // All hooks must run unconditionally — early return is below them
    const activeEntries = mode === 'year' ? yearWindowEntries : monthWindow;
    const stackData = useMemo(
        () => buildStackDataFromEntries(activeEntries, mode === 'year' ? jumpMonthWindowToYear : null),
        [activeEntries, mode, jumpMonthWindowToYear, buildStackDataFromEntries]
    );
    const incomeData = useMemo(
        () => incomeForEntries(activeEntries),
        [activeEntries, incomeForEntries]
    );

    // Early return AFTER all hooks
    if (!ready) {
        // While data is still arriving from IDB or server: show nothing (blank) to
        // avoid the jarring spinner→chart switch. Only show the placeholder if the
        // load is fully done and there genuinely is no data (empty account), or if
        // active file-processing is in progress and we want progress feedback.
        const isProcessing = categorising
            || processingStage === 'parsing'
            || processingStage === 'checkingCache'
            || processingStage === 'waitingForLLM';
        if (isProcessing) return <LoadingBarsPlaceholder message="Processing your transactions..." />;
        if (isLoading) return null;
        return <LoadingBarsPlaceholder message="No categorised transactions yet — upload a CSV to see charts." />;
    }

    const canGoBack = mode === 'year' ? canScrollYearBack : canScrollMonthBack;
    const canGoForward = mode === 'year' ? canScrollYearForward : canScrollMonthForward;

    function handleScroll(direction) {
        if (mode === 'year') {
            scrollYearWindow(direction);
        } else {
            scrollMonthWindow(direction);
        }
    }

    // Full-history bounds (fixed, never change with the current
    // window) - the slider's labels always show the ENTIRE range the
    // person has data for, not just the current 12-item window.
    const sliderStartLabel = mode === 'year'
        ? String(yearBounds?.earliestYear ?? '')
        : monthBounds ? `${monthBounds.earliest.month}/${monthBounds.earliest.year}` : '';
    const sliderEndLabel = mode === 'year'
        ? String(yearBounds?.latestYear ?? '')
        : monthBounds ? `${monthBounds.latest.month}/${monthBounds.latest.year}` : '';

    return (
        <>
            <div className="chart-header-row">
                <p className="section-label">
                    {mode === 'year' ? 'Spending by year' : 'Spending by month'} — hover over a segment for details
                </p>
                <ChartWindowToggle mode={mode} setMode={setMode} />
            </div>

            <IncomeLegend incomeData={incomeData} />

            <div className="window-scroll-row">
                <SpendingStackChart
                    stackData={stackData}
                    incomeData={incomeData}
                    heightScale={heightScale}
                    popupVariant={POPUP_VARIANT}
                    activeSegment={activeSegment}
                    onSegmentInteract={handleSegmentInteract}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartBackgroundClick={handleChartBackgroundClick}
                    mode={mode}
                    monthWindowStart={monthWindowStart}
                    yearWindowStart={yearWindowStart}
                    selectedCategories={selectedCategories}
                    onRestoreWindow={onRestoreWindow}
                    onRestoreCategories={onRestoreCategories}
                />
            </div>

            <div className="window-nav-row">
                <button
                    className="window-nav-btn"
                    style={{ visibility: canGoBack ? 'visible' : 'hidden' }}
                    onClick={() => handleScroll(-1)}
                >
                    ◀
                </button>
                <button
                    className="window-nav-btn"
                    style={{ visibility: canGoForward ? 'visible' : 'hidden' }}
                    onClick={() => handleScroll(1)}
                >
                    ▶
                </button>
            </div>
            {/* 
            <RangeWindowSlider
                trackMax={mode === 'year' ? yearSliderTrackMax : monthSliderTrackMax}
                currentIndex={mode === 'year' ? yearSliderCurrentIndex : monthSliderCurrentIndex}
                onChangeIndex={mode === 'year' ? setYearWindowByIndex : setMonthWindowByIndex}
                startLabel={sliderStartLabel}
                endLabel={sliderEndLabel}
            />
            */}
            {POPUP_VARIANT === POPUP_STATES.BELOW_CHART && <SegmentPopupFixed segment={activeSegment} />}
        </>
    );
}