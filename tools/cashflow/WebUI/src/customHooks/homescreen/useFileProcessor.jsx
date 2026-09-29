import { useUploadSession } from '../../appState/UploadSessionContext';

// The processing pipeline lives in UploadSessionContext: an upload started on
// one screen keeps reporting progress (and still opens manual review) after a
// resize swaps that screen out.
export function useFileProcessor() {
    const { processFiles, categoriseSelected, loading, setLoading, progress, duplicateNotice, clearDuplicateNotice } = useUploadSession();
    return { processFiles, categoriseSelected, loading, setLoading, progress, duplicateNotice, clearDuplicateNotice };
}
