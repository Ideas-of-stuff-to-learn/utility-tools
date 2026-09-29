import { useTransactions, useProcessing } from '../appState';
import { useInitialLoadLogic } from '../customHooks/homescreen/useInitialLoadLogic';
import { useLogout } from '../customHooks/homescreen/useLogout';
import { useFilePicker } from '../customHooks/homescreen/useFilePicker';
import { useFileProcessor } from '../customHooks/homescreen/useFileProcessor';
import { NOT_YET_CATEGORISED } from '../checkingName';
import HomepageInfo from '../components/homepage/homepageInfo';
import ActionButtons from '../components/homepage/ActionButtons';
import '../styles/homePage.css'
import '../styles/shared.css'

export default function HomeScreen() {
    const { transactions, allTransactionsLoaded, uploadBreakdown } = useTransactions();
    const { categorising } = useProcessing();
    const { dateRangeInfo } = useInitialLoadLogic();
    const { handleLogout } = useLogout();
    const { pickFiles, selectedFiles, status, error } = useFilePicker();
    const { categoriseSelected, loading, progress, duplicateNotice, clearDuplicateNotice } = useFileProcessor();

    const notYetCategorisedCount = transactions.filter(t => t.category === NOT_YET_CATEGORISED).length;

    return (
        <div className="scroll-view">
            <div className="scroll-content">
                <HomepageInfo dateRangeInfo={dateRangeInfo} uploadBreakdown={uploadBreakdown} />

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
                    showGoToCharts
                    duplicateNotice={duplicateNotice}
                    onDismissDuplicateNotice={clearDuplicateNotice}
                />
            </div>
        </div>
    );
}