import { useState } from 'react';
import '../../styles/chartStyles.css';
import SpendingStackChart from './SpendingStackedChart';
import LoadingBarsPlaceholder from '../loading/LoadingBarsPlaceholder';
import { useDataReadiness } from '../../customHooks/charts/useDataReadiness';
import { useTransactions, useProcessing } from '../../appState';

export default function YearlyChartSection({
    ready, hasData,
    yearChartData, yearIncomeLineData,
    selectedYear, selectedYearSegment, selectedYearTotal,
}) {
    const [heightScale, setHeightScale] = useState(1);
    const { initialLoading } = useTransactions();
    const { categorising, processingStage } = useProcessing();
    const { isLoading } = useDataReadiness(hasData, { initialLoading, categorising, processingStage });

    if (!ready) return null;

    if (isLoading) return <LoadingBarsPlaceholder message="Preparing your charts..." />;

    if (!hasData) {
        return (
            <LoadingBarsPlaceholder
                message={isLoading ? 'Preparing your charts...' : 'No categorised transactions yet — upload a CSV to see charts.'}
            />
        );
    }

    function displayWithSeperators(number) {
        return number.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    return (
        <>
            <p className="section-label">Spending by year — tap a segment to see months</p>
            {/* 
            <div className="zoom-row">
                <span className="section-label">Segment scale: {heightScale.toFixed(1)}x</span>
                <input type="range" className="zoom-slider" min={1} max={5} step={0.5}
                    value={heightScale} onChange={e => setHeightScale(parseFloat(e.target.value))} />
            </div>
            */}
            <SpendingStackChart stackData={yearChartData} incomeData={yearIncomeLineData} heightScale={heightScale} />
            {selectedYearSegment && (
                <p className="tapped-value-text">
                    {selectedYearSegment.year} — {selectedYearSegment.category}: £{displayWithSeperators(selectedYearSegment.value)}
                </p>
            )}
        </>
    );
}