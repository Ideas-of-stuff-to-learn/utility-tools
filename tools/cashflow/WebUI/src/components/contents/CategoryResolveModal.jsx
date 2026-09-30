import { useEffect } from 'react';
import '../../styles/contentsStyles.css';
import { ROW_HEIGHT } from '../../utils/contentsscreen/contentsUtils';

export default function CategoryResolveModal({
    reviewItem,
    bulkPickerVisible,
    selectedCount,
    manualReviewCount,
    selectableCategories,
    onPickCategory,
    onClose,
}) {
    const open = !!reviewItem || bulkPickerVisible;

    // Escape closes it, same as clicking the backdrop.
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-card" role="dialog" aria-modal="true" aria-label="Choose a category" onClick={e => e.stopPropagation()}>
                <div className="modal-title-row">
                    <h2 className="modal-title">
                        {bulkPickerVisible
                            ? `Categorise ${selectedCount} transaction${selectedCount === 1 ? '' : 's'}`
                            : 'Categorise this transaction'}
                    </h2>
                    {manualReviewCount > 0 && (
                        <span className="modal-remaining-count">
                            {manualReviewCount} left
                        </span>
                    )}
                </div>
                {!bulkPickerVisible && reviewItem && (
                    <>
                        <p className="modal-desc">{reviewItem.description}</p>
                        <p className="modal-amount">
                            £{Math.abs(reviewItem.amount || 0).toFixed(2)} · {reviewItem.date}
                        </p>
                    </>
                )}
                <div className="modal-list">
                    {selectableCategories.map(cat => (
                        <button
                            key={cat}
                            className="modal-option"
                            onClick={() => onPickCategory(cat)}
                        >
                            <span className="modal-option-text">{cat}</span>
                        </button>
                    ))}
                </div>
                <button className="modal-cancel-btn" onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}
