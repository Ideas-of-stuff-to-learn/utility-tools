// The chart can render as soon as there is data: StackChartCanvas measures
// its container at draw time (rAF + ResizeObserver). The old one-frame rAF
// gate here re-armed on every mount, flashing the loading bars whenever a
// resize swapped screens.
export function useDetailedChartReveal(hasData) {
    return hasData;
}
