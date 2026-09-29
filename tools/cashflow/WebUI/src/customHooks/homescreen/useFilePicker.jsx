import { useUploadSession } from '../../appState/UploadSessionContext';

// State lives in UploadSessionContext so picked files survive the
// Dashboard ↔ HomeScreen swap when the viewport crosses the mobile breakpoint.
export function useFilePicker() {
    const { pickFiles, selectedFiles, setSelectedFiles, status, setStatus, error, setError } = useUploadSession();
    return { pickFiles, selectedFiles, setSelectedFiles, status, setStatus, error, setError };
}
