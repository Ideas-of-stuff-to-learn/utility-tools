import { memo } from 'react';
import StackBar from './StackBar';
import ChartPopupLayer from './ChartPopupLayer';
import YAxisLabelColumn from './YAxisLabelColumn';
import ChartGridLines from './ChartGridlines';
import IncomeLine from './IncomeLine';
import BarTotalsLayer from './BarTotalsLayer';
import BarLabelsRow from './BarLabelsRow';
import ChartBackgroundCatcher from './ChartBackgroundCatcher';
import {
    computeYAxisLabels,
    computeIncomePoints,
} from '../../utils/charts/stackChartGeometry';
import '../../styles/stackedChartStyles.css';
import { useRef, useLayoutEffect } from 'react';

const BAR_WIDTH = 32;
const BAR_SPACING = 20;
const BASE_CHART_HEIGHT = 270;
const LEFT_PADDING = 10;
const LABEL_ROW_HEIGHT = 24;
const Y_AXIS_LABEL_WIDTH = 46;
const Y_AXIS_SECTIONS = 4;
const TOP_PADDING = 10;
const LABEL_HEADROOM = 24;

// This file is now PURELY composition - every visual piece (bars,
// gridlines, income line, totals, bottom labels, click-catcher, popup
// selection) is its own named component. This file's only remaining
// job is: compute the shared numbers every piece needs (chartHeight,
// totalWidth, maxValue, etc.), then hand each piece exactly what it
// needs and place them in the right stacking order.
function SpendingStackChart({
    stackData, incomeData, heightScale = 1,
    popupVariant, activeSegment,
    onSegmentInteract, onChartMouseLeave, onChartBackgroundClick,
}) {
    if (!stackData || stackData.length === 0) {
        return null;
    }
    
    // NEW - a ref to the horizontally-scrollable container, so we can
    // programmatically move its scroll position.
    const hscrollRef = useRef(null);
    // NEW - whenever the visible data changes (mode toggled, window
    // scrolled), jump the horizontal scroll to its rightmost edge, so
    // the most recent bars are what's initially visible - scrolling
    // LEFT reveals older ones within this same 12-item window. Runs
    // after every stackData change, not just on first mount.
    useLayoutEffect(() => {
        if (hscrollRef.current) {
            // rightmost
            hscrollRef.current.scrollLeft = hscrollRef.current.scrollWidth;
            // leftmost
            // hscrollRef.current.scrollLeft = 0;
            // middle
            // const el = hscrollRef.current;
            // el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
        }
    }, [stackData]);

    const chartHeight = BASE_CHART_HEIGHT * heightScale;
    const columnWidth = BAR_WIDTH + BAR_SPACING;
    const totalWidth = LEFT_PADDING * 2 + stackData.length * columnWidth;
    const barTotals = stackData.map(bar => bar.total ?? bar.stacks.reduce((sum, s) => sum + s.value, 0));

    const incomeValues = (incomeData || []).map(d => d.value || 0);
    const maxValue = Math.max(1, ...barTotals, ...incomeValues);

    const yAxisLabels = computeYAxisLabels({
        maxValue, sections: Y_AXIS_SECTIONS, labelHeadroom: LABEL_HEADROOM, topPadding: TOP_PADDING, chartHeight,
    });

    const incomePoints = computeIncomePoints({
        incomeData, leftPadding: LEFT_PADDING, columnWidth, barWidth: BAR_WIDTH,
        maxValue, labelHeadroom: LABEL_HEADROOM, topPadding: TOP_PADDING, chartHeight,
    });

    const contentHeight = LABEL_HEADROOM + TOP_PADDING + chartHeight + LABEL_ROW_HEIGHT;
    const svgHeight = LABEL_HEADROOM + TOP_PADDING + chartHeight;
    const xAxisY = LABEL_HEADROOM + TOP_PADDING + chartHeight;

    return (
        <>
            <div
                className="stack-chart-scroll"
                onMouseLeave={onChartMouseLeave}
                style={{ position: 'relative' }}
            >
                <div style={{ display: 'flex' }}>
                    <YAxisLabelColumn
                        yAxisLabels={yAxisLabels}
                        width={Y_AXIS_LABEL_WIDTH}
                        height={LABEL_HEADROOM + TOP_PADDING + chartHeight}
                    />

                    <div className="stack-chart-hscroll" ref={hscrollRef}>
                        <div style={{ width: totalWidth, height: contentHeight, position: 'relative' }}>
                            <ChartBackgroundCatcher
                                totalWidth={totalWidth}
                                contentHeight={contentHeight}
                                onClick={onChartBackgroundClick}
                            />

                            <ChartGridLines yAxisLabels={yAxisLabels} totalWidth={totalWidth} xAxisY={xAxisY} />

                            <div style={{ position: 'absolute', top: LABEL_HEADROOM + TOP_PADDING, left: 0, width: totalWidth, height: chartHeight }}>
                                {stackData.map((bar, barIndex) => (
                                    <StackBar
                                        key={barIndex}
                                        bar={bar}
                                        barIndex={barIndex}
                                        maxValue={maxValue}
                                        chartHeight={chartHeight}
                                        columnWidth={columnWidth}
                                        heightScale={heightScale}
                                        onSegmentInteract={onSegmentInteract}
                                        labelHeadroom={LABEL_HEADROOM}
                                        topPadding={TOP_PADDING}
                                        popupVariant={popupVariant}
                                    />
                                ))}
                            </div>

                            <IncomeLine incomeData={incomeData} incomePoints={incomePoints} totalWidth={totalWidth} svgHeight={svgHeight} />

                            <BarTotalsLayer
                                stackData={stackData}
                                totalWidth={totalWidth}
                                layerHeight={svgHeight}
                                columnWidth={columnWidth}
                                leftPadding={LEFT_PADDING}
                                barWidth={BAR_WIDTH}
                                maxValue={maxValue}
                                chartHeight={chartHeight}
                                heightScale={heightScale}
                                labelHeadroom={LABEL_HEADROOM}
                                topPadding={TOP_PADDING}
                            />

                            <ChartPopupLayer popupVariant={popupVariant} activeSegment={activeSegment} />

                            <BarLabelsRow
                                stackData={stackData}
                                totalWidth={totalWidth}
                                rowTop={xAxisY + 2}
                                rowHeight={LABEL_ROW_HEIGHT}
                                columnWidth={columnWidth}
                                leftPadding={LEFT_PADDING}
                                barWidth={BAR_WIDTH}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default memo(SpendingStackChart);