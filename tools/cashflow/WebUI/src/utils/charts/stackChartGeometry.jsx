// utils/charts/stackChartGeometry.js
//
// Pure positioning/geometry math for the stacked chart - no React,
// no rendering, just numbers in, numbers out. Extracted out of
// SpendingStackedChart.jsx so the actual math is readable and
// testable on its own, separate from JSX/event-handling concerns.
import { transformValue } from './chartUtils';

// The five gridlines (0%, 25%, 50%, 75%, 100% of maxValue) and their
// y-positions - shared by both the fixed y-axis label column and the
// gridlines drawn inside the scrollable bars area.
export function computeYAxisLabels({ maxValue, sections, labelHeadroom, topPadding, chartHeight }) {
    return Array.from({ length: sections + 1 }, (_, i) => {
        const value = (maxValue / sections) * i;
        return { value, y: labelHeadroom + topPadding + chartHeight - (value / maxValue) * chartHeight };
    });
}

// The SVG polyline points string for the income line.
export function computeIncomePoints({ incomeData, leftPadding, columnWidth, barWidth, maxValue, labelHeadroom, topPadding, chartHeight }) {
    return (incomeData || [])
        .map((d, i) => {
            const x = leftPadding + i * columnWidth + barWidth / 2;
            const y = labelHeadroom + topPadding + chartHeight - ((d.value || 0) / maxValue) * chartHeight;
            return `${x},${y}`;
        })
        .join(' ');
}

// Where a single bar's total-label should sit, computed from the SAME
// segment-height math StackBar uses to render (padding + heightScale
// transform included) - not the bar's true total, which can sit at a
// different visual height once padding/zoom is applied.
export function computeBarTotalLabelPosition(bar, { maxValue, chartHeight, heightScale, labelHeadroom, topPadding }) {
    const visibleSum = bar.stacks.reduce((sum, segment) => {
        const scaledValue = heightScale > 1 ? transformValue(segment.value, maxValue, heightScale) : segment.value;
        return sum + (scaledValue / maxValue) * chartHeight;
    }, 0);
    return labelHeadroom + topPadding + chartHeight - visibleSum;
}

// Array-returning version of computeIncomePoints for canvas rendering.
// Returns [{x, y}] instead of an SVG points string.
export function computeIncomePointsArray({ incomeData, leftPadding, columnWidth, barWidth, maxValue, labelHeadroom, topPadding, chartHeight }) {
    return (incomeData || []).map((d, i) => ({
        x: leftPadding + i * columnWidth + barWidth / 2,
        y: labelHeadroom + topPadding + chartHeight - ((d.value || 0) / maxValue) * chartHeight,
    }));
}

// The anchor point a popup should appear at for a given segment click -
// horizontally centered on the bar, vertically at the segment's own
// top edge. Used by both the fixed-position and floating popup
// variants (floating uses it directly; fixed ignores it entirely).
export function computeSegmentAnchor({ barIndex, columnWidth, leftPadding, barWidth, bottom, segHeight, labelHeadroom, topPadding, chartHeight }) {
    const x = leftPadding + barIndex * columnWidth + barWidth / 2;
    const y = (labelHeadroom + topPadding + chartHeight) - (bottom + segHeight);
    return { x, y };
}