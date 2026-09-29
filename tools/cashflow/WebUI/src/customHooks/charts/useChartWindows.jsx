import { getMonthWindow, getDefaultMonthWindowStart, getMonthDataBounds, addMonths } from '../../utils/charts/monthWindow';
import { getYearWindow, getDefaultYearWindowStart, getYearDataBounds, syncYearWindowToMonthWindow } from '../../utils/charts/yearWindow';
import { WINDOW_SIZE_OFFSET } from '../../utils/charts/chartWindowConfig';
import { useMemo, useCallback } from 'react';
import { useChartFilter } from '../../appState';

// Window starts live in ChartFilterContext so they survive screen remounts.
// Until the user scrolls, the override is null and the window follows the
// latest data — it used to be frozen at whatever existed on mount, which is
// nothing when the dashboard renders before data arrives.
export function useChartWindows(monthly, yearly) {
    const {
        monthWindowStartOverride, setMonthWindowStartOverride,
        yearWindowStartOverride, setYearWindowStartOverride,
    } = useChartFilter();

    const monthBounds = useMemo(() => getMonthDataBounds(monthly), [monthly]);
    const yearBounds = useMemo(() => getYearDataBounds(yearly), [yearly]);

    const defaultMonthStart = useMemo(() => getDefaultMonthWindowStart(monthly), [monthly]);
    const defaultYearStart = useMemo(() => getDefaultYearWindowStart(yearly), [yearly]);
    const monthWindowStart = monthWindowStartOverride ?? defaultMonthStart;
    const yearWindowStart = yearWindowStartOverride ?? defaultYearStart;
    const setMonthWindowStart = setMonthWindowStartOverride;
    const setYearWindowStart = setYearWindowStartOverride;

    const monthWindow = useMemo(() => getMonthWindow(monthly, monthWindowStart.year, monthWindowStart.month), [monthly, monthWindowStart]);
    const yearWindowEntries = useMemo(() => getYearWindow(yearly, yearWindowStart), [yearly, yearWindowStart]);

    // The SAME earliest/latest start bounds setMonthWindow uses to
    // clamp, computed here too (memoized) so both the clamp logic AND
    // the canScroll booleans below stay in sync with ONE source of
    // truth, rather than duplicating the bound calculation twice.
    //
    // GUARD: if WINDOW_SIZE is configured larger than the actual data
    // span, the naive "latest minus offset" calculation can land
    // BEFORE the earliest real data point (an inverted range). Force
    // latestStart back to earliestStart in that case, so the window's
    // start can never go earlier than true earliest data, no matter
    // how large WINDOW_SIZE is set.
    const monthWindowBoundsStart = useMemo(() => {
        if (!monthBounds) return null;
        const earliestStart = { year: monthBounds.earliest.year, month: monthBounds.earliest.month };
        let latestStart = addMonths(monthBounds.latest.year, monthBounds.latest.month, -WINDOW_SIZE_OFFSET);
        const earliestKey = earliestStart.year * 100 + earliestStart.month;
        const latestKey = latestStart.year * 100 + latestStart.month;
        if (latestKey < earliestKey) latestStart = earliestStart;

        return { earliestStart, latestStart };
    }, [monthBounds]);

    const setMonthWindow = useCallback((newStart) => {
        let clamped = newStart;
        if (monthBounds) {
            const earliestStart = { year: monthBounds.earliest.year, month: monthBounds.earliest.month };
            let latestStart = addMonths(monthBounds.latest.year, monthBounds.latest.month, -WINDOW_SIZE_OFFSET);
            const earliestKey = earliestStart.year * 100 + earliestStart.month;
            let latestKey = latestStart.year * 100 + latestStart.month;
            if (latestKey < earliestKey) { latestStart = earliestStart; latestKey = earliestKey; }

            const clampedKey = newStart.year * 100 + newStart.month;
            if (clampedKey < earliestKey) clamped = earliestStart;
            else if (clampedKey > latestKey) clamped = latestStart;
        }

        setMonthWindowStart(clamped);
        const newMonthWindow = getMonthWindow(monthly, clamped.year, clamped.month);
        setYearWindowStart(prev => syncYearWindowToMonthWindow(prev ?? defaultYearStart, newMonthWindow));
    }, [monthly, monthBounds, defaultYearStart, setMonthWindowStart, setYearWindowStart]);

    const scrollMonthWindow = useCallback((deltaMonths) => {
        setMonthWindow(addMonths(monthWindowStart.year, monthWindowStart.month, deltaMonths));
    }, [monthWindowStart, setMonthWindow]);

    const jumpMonthWindowToYear = useCallback((year) => {
        setMonthWindow({ year, month: 1 });
    }, [setMonthWindow]);

    // Absolute jump, for the slider. `index` is 0-based, counted from
    // the earliest real month. setMonthWindow already clamps (with the
    // oversized-window guard above), so an out-of-range index just
    // clamps to the nearest valid window.
    const setMonthWindowByIndex = useCallback((index) => {
        if (!monthBounds) return;
        setMonthWindow(addMonths(monthBounds.earliest.year, monthBounds.earliest.month, index));
    }, [monthBounds, setMonthWindow]);

    const scrollYearWindow = useCallback((deltaYears) => {
        setYearWindowStart(prev => {
            let next = (prev ?? defaultYearStart) + deltaYears;
            if (yearBounds) {
                const earliestStart = yearBounds.earliestYear;
                let latestStart = yearBounds.latestYear - WINDOW_SIZE_OFFSET;
                if (latestStart < earliestStart) latestStart = earliestStart; // GUARD - same oversized-window fix as months
                if (next < earliestStart) next = earliestStart;
                if (next > latestStart) next = latestStart;
            }
            return next;
        });
    }, [yearBounds, defaultYearStart, setYearWindowStart]);

    const setYearWindowByIndex = useCallback((index) => {
        if (!yearBounds) return;
        let next = yearBounds.earliestYear + index;
        let latestStart = yearBounds.latestYear - WINDOW_SIZE_OFFSET;
        if (latestStart < yearBounds.earliestYear) latestStart = yearBounds.earliestYear; // GUARD
        if (next < yearBounds.earliestYear) next = yearBounds.earliestYear;
        if (next > latestStart) next = latestStart;
        setYearWindowStart(next);
    }, [yearBounds, setYearWindowStart]);

    const canScrollMonthBack = monthWindowBoundsStart
        ? (monthWindowStart.year * 100 + monthWindowStart.month) > (monthWindowBoundsStart.earliestStart.year * 100 + monthWindowBoundsStart.earliestStart.month)
        : false;

    const canScrollMonthForward = monthWindowBoundsStart
        ? (monthWindowStart.year * 100 + monthWindowStart.month) < (monthWindowBoundsStart.latestStart.year * 100 + monthWindowBoundsStart.latestStart.month)
        : false;

    const canScrollYearBack = yearBounds ? yearWindowStart > yearBounds.earliestYear : false;
    const canScrollYearForward = yearBounds
        ? yearWindowStart < Math.max(yearBounds.earliestYear, yearBounds.latestYear - WINDOW_SIZE_OFFSET)
        : false;

    // Max valid WINDOW-START index (used for clamping/slider bounds) -
    // floored at 0 as a defensive guard, since monthWindowBoundsStart's
    // own oversized-window fix above should already prevent a negative
    // result, but this is cheap insurance given how much depends on it.
    const monthSliderMaxIndex = monthWindowBoundsStart
        ? Math.max(0, (monthWindowBoundsStart.latestStart.year * 12 + monthWindowBoundsStart.latestStart.month) - (monthBounds.earliest.year * 12 + monthBounds.earliest.month))
        : 0;
    const monthSliderCurrentIndex = monthBounds
        ? (monthWindowStart.year * 12 + monthWindowStart.month) - (monthBounds.earliest.year * 12 + monthBounds.earliest.month)
        : 0;

    const yearSliderMaxIndex = yearBounds
        ? Math.max(0, (yearBounds.latestYear - WINDOW_SIZE_OFFSET) - yearBounds.earliestYear)
        : 0;
    const yearSliderCurrentIndex = yearBounds ? yearWindowStart - yearBounds.earliestYear : 0;

    // The FULL raw timeline span (not minus the offset) - what the
    // two-handle slider's TRACK itself needs, since the RIGHT handle
    // must be able to visually reach the true latest data point, even
    // though the window's START can't go that far (that's what
    // monthSliderMaxIndex/yearSliderMaxIndex above still enforce).
    const monthSliderTrackMax = monthBounds
        ? (monthBounds.latest.year * 12 + monthBounds.latest.month) - (monthBounds.earliest.year * 12 + monthBounds.earliest.month)
        : 0;
    const yearSliderTrackMax = yearBounds ? yearBounds.latestYear - yearBounds.earliestYear : 0;

    return {
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
        monthBounds, yearBounds,
    };
}