import { useRef, useEffect, useState, useLayoutEffect } from 'react';
import YAxisLabelColumn from './YAxisLabelColumn';
import ChartPopupLayer from './ChartPopupLayer';
import {
    computeYAxisLabels,
    computeIncomePointsArray,
    computeBarTotalLabelPosition,
    computeSegmentAnchor,
} from '../../utils/charts/stackChartGeometry';
import { transformValue } from '../../utils/charts/chartUtils';
import { INTERACTION_MODE, INTERACTION_MODES } from '../../config/popupChartConfig';
import '../../styles/stackedChartStyles.css';

const BAR_WIDTH          = 32;
const BAR_SPACING        = 20;
const BASE_CHART_HEIGHT  = 270;
const LEFT_PADDING       = 10;
const LABEL_ROW_HEIGHT   = 24;
const Y_AXIS_LABEL_WIDTH = 46;
const Y_AXIS_SECTIONS    = 4;
const TOP_PADDING        = 10;
const LABEL_HEADROOM     = 24;

const FONT_BAR_LABEL = "400 10px 'Inter Tight', system-ui, sans-serif";
const FONT_BAR_TOTAL = "600 11px 'Inter Tight', system-ui, sans-serif";

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getCSSVars() {
    const s = getComputedStyle(document.documentElement);
    return {
        border:       s.getPropertyValue('--border').trim()        || '#e4e9f0',
        borderStrong: s.getPropertyValue('--border-strong').trim() || '#bcc8da',
        textPrimary:  s.getPropertyValue('--text-primary').trim()  || '#0e1422',
    };
}

export default function StackChartCanvas({
    stackData: stackDataProp, incomeData, heightScale = 1,
    popupVariant, activeSegment,
    onSegmentInteract, onChartMouseLeave, onChartBackgroundClick,
}) {
    // Every hook runs unconditionally; the empty-data return is at the end.
    const canvasRef      = useRef(null);
    const containerRef   = useRef(null);
    const dprRef         = useRef(window.devicePixelRatio || 1);
    const pendingDraw    = useRef(false);
    const scrollRef      = useRef(0);  // mirror of scrollOffsetX for use inside callbacks
    const touchStartXRef = useRef(0);
    const drawRef        = useRef(null);
    const [scrollOffsetX, setScrollOffsetX] = useState(0);

    const stackData = stackDataProp || [];
    const hasBars = stackData.length > 0;

    // Geometry derived from props
    const chartHeight   = BASE_CHART_HEIGHT * heightScale;
    const columnWidth   = BAR_WIDTH + BAR_SPACING;
    const totalWidth    = LEFT_PADDING * 2 + stackData.length * columnWidth;
    const contentHeight = LABEL_HEADROOM + TOP_PADDING + chartHeight + LABEL_ROW_HEIGHT;
    const svgHeight     = LABEL_HEADROOM + TOP_PADDING + chartHeight;
    const xAxisY        = svgHeight;
    const barAreaTop    = LABEL_HEADROOM + TOP_PADDING;
    const barAreaBottom = barAreaTop + chartHeight;

    const barTotals  = stackData.map(bar => bar.total ?? bar.stacks.reduce((s, seg) => s + seg.value, 0));
    const incomeVals = (incomeData || []).map(d => d.value || 0);
    const maxValue   = Math.max(1, ...barTotals, ...incomeVals);

    const yAxisLabels  = computeYAxisLabels({ maxValue, sections: Y_AXIS_SECTIONS, labelHeadroom: LABEL_HEADROOM, topPadding: TOP_PADDING, chartHeight });
    const incomePoints = computeIncomePointsArray({ incomeData, leftPadding: LEFT_PADDING, columnWidth, barWidth: BAR_WIDTH, maxValue, labelHeadroom: LABEL_HEADROOM, topPadding: TOP_PADDING, chartHeight });

    function getMaxScroll() {
        if (!containerRef.current) return 0;
        return Math.max(0, totalWidth - containerRef.current.clientWidth);
    }

    // ── Draw ─────────────────────────────────────────────────────────────
    function draw(overrideScroll) {
        const canvas    = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !hasBars) return;

        const scroll   = overrideScroll !== undefined ? overrideScroll : scrollRef.current;
        const logicalW = container.clientWidth;
        const logicalH = contentHeight;
        const d        = dprRef.current;

        // Resize physical pixels if needed
        const needsW = Math.round(logicalW * d);
        const needsH = Math.round(logicalH * d);
        if (canvas.width !== needsW || canvas.height !== needsH) {
            canvas.width  = needsW;
            canvas.height = needsH;
            canvas.style.width  = logicalW + 'px';
            canvas.style.height = logicalH + 'px';
        }

        const ctx = canvas.getContext('2d');
        ctx.resetTransform();
        ctx.scale(d, d);
        ctx.clearRect(0, 0, logicalW, logicalH);

        const { border, borderStrong, textPrimary } = getCSSVars();

        ctx.save();
        ctx.translate(-scroll, 0);

        // 1. Gridlines
        ctx.lineWidth = 1;
        yAxisLabels.forEach(label => {
            ctx.beginPath();
            ctx.moveTo(0, label.y);
            ctx.lineTo(totalWidth, label.y);
            ctx.strokeStyle = border;
            ctx.stroke();
        });
        ctx.beginPath();
        ctx.moveTo(0, xAxisY);
        ctx.lineTo(totalWidth, xAxisY);
        ctx.strokeStyle = borderStrong;
        ctx.stroke();

        // 2. Bars
        stackData.forEach((bar, barIndex) => {
            let cumulativeBottom = 0;
            const visibleSegs = bar.stacks.filter(s => s.value > 0);
            const topSegIdx = visibleSegs.length > 0 ? bar.stacks.indexOf(visibleSegs[visibleSegs.length - 1]) : -1;

            bar.stacks.forEach((segment, segIndex) => {
                const scaledValue = heightScale > 1 ? transformValue(segment.value, maxValue, heightScale) : segment.value;
                const segHeight   = (scaledValue / maxValue) * chartHeight;
                const bottom      = cumulativeBottom;
                cumulativeBottom += segHeight;
                if (segHeight <= 0) return;

                const barLeft = LEFT_PADDING + barIndex * columnWidth;
                const rectTop = barAreaBottom - bottom - segHeight;
                const isTop   = segIndex === topSegIdx;
                const posKey  = `${barIndex}-${segIndex}`;
                const isActive = activeSegment && activeSegment._positionKey === posKey;

                ctx.beginPath();
                if (isTop) {
                    const r = 4;
                    ctx.moveTo(barLeft + r, rectTop);
                    ctx.lineTo(barLeft + BAR_WIDTH - r, rectTop);
                    ctx.quadraticCurveTo(barLeft + BAR_WIDTH, rectTop, barLeft + BAR_WIDTH, rectTop + r);
                    ctx.lineTo(barLeft + BAR_WIDTH, rectTop + segHeight);
                    ctx.lineTo(barLeft, rectTop + segHeight);
                    ctx.lineTo(barLeft, rectTop + r);
                    ctx.quadraticCurveTo(barLeft, rectTop, barLeft + r, rectTop);
                    ctx.closePath();
                } else {
                    ctx.rect(barLeft, rectTop, BAR_WIDTH, segHeight);
                }
                ctx.fillStyle = segment.color;
                ctx.fill();

                if (isActive) {
                    ctx.fillStyle = 'rgba(0,0,0,0.4)';
                    ctx.fill();
                }
            });
        });

        // 3. Income line
        if (incomeData && incomeData.length > 1 && incomePoints.length > 1) {
            ctx.beginPath();
            ctx.strokeStyle = '#27AE60';
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            incomePoints.forEach(({ x, y }, i) => {
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        // 4. Bar total labels
        ctx.font = FONT_BAR_TOTAL;
        ctx.fillStyle = textPrimary;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        stackData.forEach((bar, i) => {
            const barTopY = computeBarTotalLabelPosition(bar, { maxValue, chartHeight, heightScale, labelHeadroom: LABEL_HEADROOM, topPadding: TOP_PADDING });
            const labelY  = barTopY - 7;  // top - 18 + ~11px baseline
            const cx      = LEFT_PADDING + i * columnWidth + BAR_WIDTH / 2;
            ctx.fillText(`£${Math.round(bar.total ?? 0).toLocaleString()}`, cx, labelY);
        });

        // 5. X-axis bar labels
        ctx.font = FONT_BAR_LABEL;
        ctx.fillStyle = textPrimary;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelTop = xAxisY + 5;
        stackData.forEach((bar, i) => {
            const cx = LEFT_PADDING + i * columnWidth + BAR_WIDTH / 2;
            ctx.fillText(bar.label, cx, labelTop);
        });

        ctx.restore();
    }

    // rAF callbacks and the ResizeObserver outlive the render that scheduled
    // them; going through this ref means they always draw the latest data.
    drawRef.current = draw;

    function scheduleDraw() {
        if (pendingDraw.current) return;
        pendingDraw.current = true;
        requestAnimationFrame(() => {
            pendingDraw.current = false;
            drawRef.current?.();
        });
    }

    // Redraw whenever deps change
    useEffect(() => { scheduleDraw(); }, [stackDataProp, incomeData, heightScale, activeSegment, scrollOffsetX]);

    // Scroll to rightmost on stackData change (useLayoutEffect avoids flash)
    useLayoutEffect(() => {
        if (!containerRef.current) return;
        const maxScroll = Math.max(0, totalWidth - containerRef.current.clientWidth);
        scrollRef.current = maxScroll;
        setScrollOffsetX(maxScroll);
    }, [stackDataProp]);

    // ResizeObserver — update DPR and redraw. Re-attached when the container
    // appears (it isn't rendered while there are no bars).
    useEffect(() => {
        if (!containerRef.current) return;
        const obs = new ResizeObserver(() => {
            dprRef.current = window.devicePixelRatio || 1;
            scheduleDraw();
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [hasBars]);

    // ── Hit testing ──────────────────────────────────────────────────────
    function hitTest(mouseX, mouseY) {
        const contentX = mouseX + scrollRef.current;
        if (mouseY < barAreaTop || mouseY > barAreaBottom) return null;

        const relX = contentX - LEFT_PADDING;
        if (relX < 0) return null;
        const barIndex = Math.floor(relX / columnWidth);
        if (barIndex < 0 || barIndex >= stackData.length) return null;

        const barLeft = LEFT_PADDING + barIndex * columnWidth;
        if (contentX < barLeft || contentX > barLeft + BAR_WIDTH) return null;

        const bar = stackData[barIndex];
        let cumulativeBottom = 0;
        let hitSegment = null;
        let hitSegIndex = -1;

        bar.stacks.forEach((segment, segIndex) => {
            const scaledValue = heightScale > 1 ? transformValue(segment.value, maxValue, heightScale) : segment.value;
            const segHeight   = (scaledValue / maxValue) * chartHeight;
            if (segHeight <= 0) return;

            const segTop    = barAreaBottom - cumulativeBottom - segHeight;
            const segBottom = barAreaBottom - cumulativeBottom;
            cumulativeBottom += segHeight;

            if (mouseY >= segTop && mouseY <= segBottom) {
                hitSegment = segment;
                hitSegIndex = segIndex;
            }
        });

        if (!hitSegment) return null;
        return { barIndex, segIndex: hitSegIndex, segment: hitSegment };
    }

    function fireSegment(hit, canvasRelX, canvasRelY) {
        const { barIndex, segIndex, segment } = hit;
        const bar = stackData[barIndex];

        let cumulativeBottom = 0;
        bar.stacks.forEach((s, i) => {
            if (i >= segIndex) return;
            const sv = heightScale > 1 ? transformValue(s.value, maxValue, heightScale) : s.value;
            cumulativeBottom += (sv / maxValue) * chartHeight;
        });
        const sv = heightScale > 1 ? transformValue(segment.value, maxValue, heightScale) : segment.value;
        const segHeight = (sv / maxValue) * chartHeight;

        segment.onPress?.();

        const anchor = computeSegmentAnchor({
            barIndex, columnWidth, leftPadding: LEFT_PADDING, barWidth: BAR_WIDTH,
            bottom: cumulativeBottom, segHeight,
            labelHeadroom: LABEL_HEADROOM, topPadding: TOP_PADDING, chartHeight,
        });

        const cursorPos = {
            x: anchor.x - scrollRef.current,
            y: anchor.y,
        };

        onSegmentInteract({
            year:     segment.year,
            month:    segment.month,
            category: segment.category,
            value:    segment.realValue,
        }, `${barIndex}-${segIndex}`, cursorPos);
    }

    // ── Event handlers ───────────────────────────────────────────────────
    function getCanvasXY(e) {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handleClick(e) {
        const { x, y } = getCanvasXY(e);
        const hit = hitTest(x, y);
        if (!hit) { onChartBackgroundClick?.(); return; }
        fireSegment(hit, x, y);
    }

    function handleMouseMove(e) {
        if (INTERACTION_MODE !== INTERACTION_MODES.HOVER) return;
        const { x, y } = getCanvasXY(e);
        const hit = hitTest(x, y);
        if (hit) fireSegment(hit, x, y);
    }

    function handleWheel(e) {
        e.preventDefault();
        const maxScroll = getMaxScroll();
        const next = clamp(scrollRef.current + e.deltaX, 0, maxScroll);
        scrollRef.current = next;
        setScrollOffsetX(next);
    }

    // Touch scroll
    function handleTouchStart(e) { touchStartXRef.current = e.touches[0].clientX; }
    function handleTouchMove(e) {
        const dx = touchStartXRef.current - e.touches[0].clientX;
        touchStartXRef.current = e.touches[0].clientX;
        const maxScroll = getMaxScroll();
        const next = clamp(scrollRef.current + dx, 0, maxScroll);
        scrollRef.current = next;
        setScrollOffsetX(next);
    }

    if (!hasBars) return null;

    return (
        <div className="stack-chart-scroll" onMouseLeave={onChartMouseLeave} style={{ position: 'relative' }}>
            <div style={{ display: 'flex' }}>
                <YAxisLabelColumn
                    yAxisLabels={yAxisLabels}
                    width={Y_AXIS_LABEL_WIDTH}
                    height={svgHeight}
                />
                <div
                    ref={containerRef}
                    style={{ position: 'relative', flex: 1, overflow: 'hidden', height: contentHeight }}
                >
                    <canvas
                        ref={canvasRef}
                        onClick={handleClick}
                        onMouseMove={handleMouseMove}
                        onWheel={handleWheel}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        style={{ display: 'block', cursor: 'pointer' }}
                        aria-label="Spending stacked bar chart"
                    />
                    <ChartPopupLayer popupVariant={popupVariant} activeSegment={activeSegment} />
                </div>
            </div>
        </div>
    );
}
