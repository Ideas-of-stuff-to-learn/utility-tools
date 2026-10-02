import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBilling } from '../../appState/BillingContext';
import { useUploadSession } from '../../appState/UploadSessionContext';
import ProgressBar from './ProgressBar';

// Shared button cluster used identically by both HomeScreen and
// Dashboard - editing wording/order here updates both places at once.
// showGoToCharts is a flag, not a separate prop threaded through by
// the caller reconstructing layout around this component - this
// component owns the full fixed order internally (Choose file -> file
// list -> progress -> error -> Categorise -> [Charts, if flagged] ->
// Transactions -> Logout), and the flag just switches whether the
// Charts button renders in its one fixed spot.
export default function ActionButtons({
    pickFiles, selectedFiles, loading, categorising,
    status, error, progress,
    handleCategorisePress, notYetCategorisedCount, allTransactionsLoaded,
    handleLogout,
    showGoToCharts = false,
    hideLogout = false,
    duplicateNotice = null,
    onDismissDuplicateNotice,
}) {
    const navigate = useNavigate();
    const { hasPro, uploadCapReached, uploadCap, uploadsToday, uploadFilesPerAction } = useBilling();
    const { setError: clearError, setSelectedFiles: clearFiles, setStatus: clearStatus } = useUploadSession();
    const [showLogoutWarn, setShowLogoutWarn] = useState(false);

    function onBackToTools() {
        if (!hasPro) { setShowLogoutWarn(true); return; }
        handleLogout();
    }

    const hasDuplicates = duplicateNotice && (
        duplicateNotice.filenames.length > 0 ||
        duplicateNotice.contents.length > 0 ||
        (duplicateNotice.batchCopies ?? []).length > 0
    );

    return (
        <>
            {hasDuplicates && (
                <div className="modal-backdrop">
                    <div className="modal-card modal-card-narrow">
                        <h1 className="modal-title" style={{ fontSize: 20, marginBottom: 12 }}>No action needed</h1>
                        {duplicateNotice.successfulCount > 0 && (
                            <p className="modal-desc duplicate-success-line">
                                {duplicateNotice.successfulCount} file{duplicateNotice.successfulCount !== 1 ? 's' : ''} successfully uploaded.
                            </p>
                        )}
                        {(duplicateNotice.batchCopies ?? []).length > 0 && (
                            <div className="duplicate-section">
                                <p className="duplicate-label"><strong>Copy of another file in the same upload — skipped:</strong></p>
                                <p className="duplicate-filenames">{duplicateNotice.batchCopies.join(', ')}</p>
                            </div>
                        )}
                        {duplicateNotice.filenames.length > 0 && (
                            <div className="duplicate-section">
                                <p className="duplicate-label"><strong>Already uploaded with the same filename — no new data:</strong></p>
                                <p className="duplicate-filenames">{duplicateNotice.filenames.join(', ')}</p>
                            </div>
                        )}
                        {duplicateNotice.contents.length > 0 && (
                            <div className="duplicate-section">
                                <p className="duplicate-label"><strong>Identical contents to a previously uploaded file:</strong></p>
                                <p className="duplicate-filenames">{duplicateNotice.contents.join(', ')}</p>
                            </div>
                        )}
                        <button className="modal-option" onClick={onDismissDuplicateNotice}>
                            <span className="modal-option-text">OK</span>
                        </button>
                    </div>
                </div>
            )}
            {uploadCapReached ? (
                <div className="upload-locked-wrap">
                    <button className="btn btn-cap-dimmed" disabled>
                        Cannot use — daily cap reached
                    </button>
                    <p className="upload-locked-hint">
                        Limit: {uploadsToday}/{uploadCap} upload{uploadCap !== 1 ? 's' : ''} today.{' '}
                        <button className="upload-locked-upgrade" onClick={() => navigate('/pricing')}>
                            Upgrade for unlimited →
                        </button>
                    </p>
                </div>
            ) : !hasPro ? (
                <div className="upload-locked-wrap">
                    <button className="btn" onClick={pickFiles} disabled={loading || categorising}>
                        Choose CSV or Excel Files
                    </button>
                    <p className="upload-locked-hint">
                        Base plan · {uploadsToday}/{uploadCap ?? 1} upload{uploadCap !== 1 ? 's' : ''} today
                        {uploadFilesPerAction ? ` · up to ${uploadFilesPerAction} files` : ''} ·{' '}
                        <button className="upload-locked-upgrade" onClick={() => navigate('/pricing')}>
                            Upgrade for unlimited →
                        </button>
                    </p>
                </div>
            ) : (
                <button className="btn" onClick={pickFiles} disabled={loading || categorising}>
                    Choose CSV or Excel Files
                </button>
            )}

            {selectedFiles.length > 0 ? (
                <div className="action-file-list">
                    <div className="action-file-list-header">
                        <span className="action-file-list-count">{selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''}</span>
                        {!loading && (
                            <button className="action-file-dismiss" onClick={() => clearFiles([])}>✕</button>
                        )}
                    </div>
                    {selectedFiles.map((f, i) => (
                        <p key={f.name || i} className="action-file-name">{f.name}</p>
                    ))}
                </div>
            ) : (
                <div className="action-file-spacer" />
            )}
            {(loading || status) && <ProgressBar progress={progress} status={status} />}
            {error && (
                <div className="action-error-wrap">
                    <p className="action-error">{error}</p>
                    {!loading && (
                        <button className="action-error-dismiss" onClick={() => { clearError(null); clearFiles([]); clearStatus(null); }}>✕ Dismiss</button>
                    )}
                </div>
            )}

            <button
                className="btn btn-secondary"
                onClick={handleCategorisePress}
                disabled={loading || categorising || !allTransactionsLoaded || (selectedFiles.length === 0 && notYetCategorisedCount === 0)}
            >
                {loading
                    ? '...'
                    : notYetCategorisedCount > 0
                        ? `Automatically categorise (retry ${notYetCategorisedCount})`
                        : 'Automatically categorise'}
            </button>

            {showGoToCharts && (
                <button className="btn btn-secondary" onClick={() => navigate('/charts')} disabled={categorising}>
                    Go to Charts
                </button>
            )}

            <button className="btn btn-secondary" onClick={() => navigate('/contents')} disabled={categorising}>
                Go to Transactions
            </button>

            {!hideLogout && (
                <div className="logout-btn-anchor">
                    <button className="logout-btn" onClick={onBackToTools}>
                        ← Back to Tools
                    </button>
                </div>
            )}

            {!hideLogout && showLogoutWarn && (
                <div className="modal-backdrop">
                    <div className="modal-card modal-card-narrow">
                        <h1 className="modal-title" style={{ fontSize: 20, marginBottom: 12 }}>Your data will be wiped</h1>
                        <p className="modal-desc">
                            On the base plan, all your transactions and uploads are deleted when you log out.
                            Upgrade to Pro or start a free trial to keep your data across sessions.
                        </p>
                        <button className="modal-option logout-warn-upgrade" onClick={() => { setShowLogoutWarn(false); navigate('/pricing'); }}>
                            <span className="modal-option-text">Upgrade / Start free trial →</span>
                        </button>
                        <button className="modal-option" onClick={() => { setShowLogoutWarn(false); handleLogout(); }}>
                            <span className="modal-option-text">Log out anyway — delete my data</span>
                        </button>
                        <button className="modal-option logout-warn-cancel" onClick={() => setShowLogoutWarn(false)}>
                            <span className="modal-option-text">Cancel — stay in the app</span>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}