import { useState, useEffect } from 'react';

// Gate the rAF on hasData so the chart only attempts to measure its container
// after data exists. While hasData=false the caller shows LoadingBarsPlaceholder.
// The rAF itself still serves its original purpose: ensure the browser has painted
// the layout before the chart reads container dimensions.
export function useDetailedChartReveal(hasData) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!hasData) {
            setReady(false);
            return;
        }
        const id = requestAnimationFrame(() => setReady(true));
        return () => cancelAnimationFrame(id);
    }, [hasData]);

    return ready;
}
