import { useUploadSession } from '../appState/UploadSessionContext';
import ProgressBar from './homepage/ProgressBar';

// Fixed-position popup showing upload state (selected files, progress, errors).
// Reads directly from UploadSessionContext so it can live anywhere in the tree.
// Rendered from Layout so it persists across route changes during an upload.
export default function UploadStatusPopup() {
    const {
        selectedFiles, setSelectedFiles,
        status, setStatus,
        error, setError,
        loading, progress,
    } = useUploadSession();

    const hasContent = selectedFiles.length > 0 || loading || !!error;
    if (!hasContent) return null;

    function dismiss() {
        if (loading) return;
        setSelectedFiles([]);
        setError(null);
        setStatus(null);
    }

    const title = loading
        ? 'Uploading…'
        : selectedFiles.length > 0
            ? `${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''} selected`
            : 'Upload';

    return (
        <div className="upload-status-popup">
            <div className="upload-status-popup-header">
                <span className="upload-status-popup-title">{title}</span>
                {!loading && (
                    <button className="upload-status-close" onClick={dismiss} title="Dismiss">✕</button>
                )}
            </div>
            {selectedFiles.length > 0 && (
                <div className="upload-status-files">
                    {selectedFiles.map((f, i) => (
                        <p key={f.name || i} className="upload-status-file-name">{f.name}</p>
                    ))}
                </div>
            )}
            <ProgressBar progress={progress} status={status} />
            {error && <p className="upload-status-error">{error}</p>}
        </div>
    );
}
