import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { parseCSVFiles } from '../api';
import { useTransactions } from './TransactionsContext';
import { useProcessing } from './ProcessingContext';
import { useChartFilter } from './ChartFilterContext';
import { mergeById } from '../utils/homescreen/homescreenUtils';
import { NOT_YET_CATEGORISED } from '../checkingName';
import { runCacheTiers } from '../customHooks/homescreen/cacheTierRunner';
import { runLlmTier } from '../customHooks/homescreen/llmTierRunner';

const UploadSessionContext = createContext(null);

const ACCEPTED = ['.csv', '.xlsx', '.xls'];
const IDLE_PROGRESS = { current: 0, total: 0, phase: '' };

// The whole upload/categorise session lives above the router, so crossing
// the mobile breakpoint (which swaps Dashboard ↔ HomeScreen) keeps picked
// files, progress, the upload-summary popup and any parked manual review.
export function UploadSessionProvider({ children }) {
    const { transactions, setTransactions, refetchUploadCount, refetchUploadBreakdown } = useTransactions();
    const { setCategorising, setProcessingStage, startManualReviewFlowIfNeeded, manualReviewFlow } = useProcessing();
    const { bumpChartDataVersion } = useChartFilter();

    const [selectedFiles, setSelectedFiles] = useState([]);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(IDLE_PROGRESS);
    const [duplicateNotice, setDuplicateNotice] = useState(null);

    // Parked until the upload summary is dismissed, so the summary always
    // precedes manual review.
    const pendingManualReviewItems = useRef(null);
    const inputRef = useRef(null);
    const transactionsRef = useRef(transactions);
    useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

    // Picked files are cleared once a manual review that followed them closes.
    const prevReviewRef = useRef(manualReviewFlow);
    useEffect(() => {
        if (prevReviewRef.current && !manualReviewFlow) setSelectedFiles([]);
        prevReviewRef.current = manualReviewFlow;
    }, [manualReviewFlow]);

    const handleFilesChosen = useCallback((e) => {
        const files = Array.from(e.target.files || []);
        const validFiles = files.filter(f => ACCEPTED.some(ext => f.name.toLowerCase().endsWith(ext)));
        if (validFiles.length === 0) {
            setStatus(null);
            setError('Please choose at least one .csv, .xlsx, or .xls file');
            return;
        }
        setSelectedFiles(validFiles);
        setError(null);
        setStatus(`${validFiles.length} file(s) selected`);
    }, []);

    // Web can only open a file dialog via a real <input type="file">; one
    // hidden input is created lazily and reused for the page's lifetime.
    const pickFiles = useCallback(() => {
        if (!inputRef.current) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = ACCEPTED.join(',');
            input.multiple = true;
            input.style.display = 'none';
            input.addEventListener('change', handleFilesChosen);
            document.body.appendChild(input);
            inputRef.current = input;
        }
        // Reset so choosing the same file(s) again still fires 'change'.
        inputRef.current.value = '';
        inputRef.current.click();
    }, [handleFilesChosen]);

    // autoTriggerManualReview: true for retry runs (no upload notice will
    // follow), false for new-file uploads (notice must appear first).
    const categorizeTransactions = useCallback(async (items, runLabel = 'Categorise', autoTriggerManualReview = true) => {
        setProcessingStage('checkingCache');
        setCategorising(true);

        const phase1 = await runCacheTiers(items, {
            setStatus, setError, setTransactions, bumpChartDataVersion, setProgress, runLabel,
        });

        setProcessingStage('waitingForLLM');
        setCategorising(true);

        await runLlmTier(phase1, {
            setStatus, setError, setTransactions, bumpChartDataVersion, setProcessingStage, setProgress, runLabel,
        });

        // Read through an updater: the LLM tier's last setTransactions may not
        // have rendered yet when its await resumes.
        const processedIds = new Set(items.map(t => t.id));
        setTransactions(current => {
            const processedNow = current.filter(t => processedIds.has(t.id));
            if (autoTriggerManualReview) startManualReviewFlowIfNeeded(processedNow);
            else pendingManualReviewItems.current = processedNow;
            return current;
        });
    }, [setProcessingStage, setCategorising, setTransactions, bumpChartDataVersion, startManualReviewFlowIfNeeded]);

    const processFiles = useCallback(async () => {
        const files = selectedFiles;
        const notYetCategorisedItems = transactionsRef.current.filter(t => t.category === NOT_YET_CATEGORISED);

        if (files.length === 0 && notYetCategorisedItems.length === 0) {
            setError('Please select files first');
            return;
        }

        setLoading(true);
        setError(null);
        setProcessingStage('parsing');

        try {
            if (notYetCategorisedItems.length > 0) {
                await categorizeTransactions(notYetCategorisedItems, 'Retry', true);
            }

            if (files.length > 0) {
                setStatus('Parsing CSV files...');
                const { transactions: parsed, duplicateFilenames, duplicateContents, batchCopyDuplicates, successfulCount } = await parseCSVFiles(files);

                setTransactions(prev => mergeById(prev, parsed));
                setCategorising(true);

                const needsCategorization = parsed.filter(t => t.category == null);
                if (needsCategorization.length > 0) {
                    await categorizeTransactions(needsCategorization, 'Categorise', false);
                }

                const hasDuplicateInfo = duplicateFilenames.length > 0 || duplicateContents.length > 0 || batchCopyDuplicates.length > 0;
                if (hasDuplicateInfo || successfulCount > 0) {
                    setDuplicateNotice({ filenames: duplicateFilenames, contents: duplicateContents, batchCopies: batchCopyDuplicates, successfulCount });
                } else {
                    const pending = pendingManualReviewItems.current;
                    pendingManualReviewItems.current = null;
                    if (pending) startManualReviewFlowIfNeeded(pending);
                }
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
            setStatus(null);
            setCategorising(false);
            setProcessingStage(prev => prev === 'done' ? 'done' : 'idle');
            setProgress(IDLE_PROGRESS);
        }
    }, [selectedFiles, categorizeTransactions, setProcessingStage, setTransactions, setCategorising, startManualReviewFlowIfNeeded]);

    // Owned here (not by the screen) so it completes even if the screen that
    // started it unmounts mid-run.
    const categoriseSelected = useCallback(async () => {
        await processFiles();
        setSelectedFiles([]);
        refetchUploadCount();
        refetchUploadBreakdown();
    }, [processFiles, refetchUploadCount, refetchUploadBreakdown]);

    const clearDuplicateNotice = useCallback(() => {
        setDuplicateNotice(null);
        const pending = pendingManualReviewItems.current;
        pendingManualReviewItems.current = null;
        if (pending) startManualReviewFlowIfNeeded(pending);
    }, [startManualReviewFlowIfNeeded]);

    return (
        <UploadSessionContext.Provider value={{
            pickFiles, selectedFiles, setSelectedFiles,
            status, setStatus, error, setError,
            processFiles, categoriseSelected,
            loading, setLoading, progress,
            duplicateNotice, clearDuplicateNotice,
        }}>
            {children}
        </UploadSessionContext.Provider>
    );
}

export function useUploadSession() {
    const ctx = useContext(UploadSessionContext);
    if (!ctx) throw new Error('useUploadSession must be inside UploadSessionProvider');
    return ctx;
}
