import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBilling } from '../../appState/BillingContext';

export default function DashboardLogoutButton({ handleLogout }) {
    const navigate = useNavigate();
    const { hasPro } = useBilling();
    const [showWarn, setShowWarn] = useState(false);

    function onBack() {
        if (!hasPro) { setShowWarn(true); return; }
        handleLogout();
    }

    return (
        <>
            <button className="logout-btn" onClick={onBack}>
                ← Back to Tools
            </button>
            {showWarn && (
                <div className="modal-backdrop">
                    <div className="modal-card modal-card-narrow">
                        <h1 className="modal-title" style={{ fontSize: 20, marginBottom: 12 }}>Your data will be wiped</h1>
                        <p className="modal-desc">
                            On the base plan, all your transactions and uploads are deleted when you log out.
                            Upgrade to Pro or start a free trial to keep your data across sessions.
                        </p>
                        <button className="modal-option logout-warn-upgrade" onClick={() => { setShowWarn(false); navigate('/pricing'); }}>
                            <span className="modal-option-text">Upgrade / Start free trial →</span>
                        </button>
                        <button className="modal-option" onClick={() => { setShowWarn(false); handleLogout(); }}>
                            <span className="modal-option-text">Log out anyway — delete my data</span>
                        </button>
                        <button className="modal-option logout-warn-cancel" onClick={() => setShowWarn(false)}>
                            <span className="modal-option-text">Cancel — stay in the app</span>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
