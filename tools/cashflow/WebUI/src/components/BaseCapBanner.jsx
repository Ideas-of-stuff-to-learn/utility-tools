import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBilling } from '../appState/BillingContext';

function useCountdown(targetIso) {
    const [ms, setMs] = useState(() => targetIso ? Math.max(0, new Date(targetIso) - Date.now()) : 0);
    useEffect(() => {
        if (!targetIso) { setMs(0); return; }
        setMs(Math.max(0, new Date(targetIso) - Date.now()));
        const id = setInterval(() => setMs(Math.max(0, new Date(targetIso) - Date.now())), 1000);
        return () => clearInterval(id);
    }, [targetIso]);
    return ms;
}

function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// compact=true → renders as a small inline note (used inside dashboard left column)
// compact=false (default) → renders as a full-width banner strip
export default function BaseCapBanner({ compact = false }) {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { hasPro, uploadCapReached, nextUploadAt } = useBilling();
    const msLeft = useCountdown(uploadCapReached ? nextUploadAt : null);

    if (hasPro) return null;
    // Full banner: skip on dashboard (compact version rendered there instead)
    if (!compact && pathname === '/dashboard') return null;
    // Compact mode: only for dashboard
    if (compact && pathname !== '/dashboard') return null;

    if (compact) {
        return (
            <p className="dashboard-session-note">
                Session-only data.{' '}
                <button className="base-cap-banner-link" onClick={() => navigate('/pricing')}>
                    Upgrade →
                </button>
                {uploadCapReached && nextUploadAt && (
                    <span> · Next upload: <strong>{formatMs(msLeft)}</strong></span>
                )}
            </p>
        );
    }

    return (
        <div className="base-cap-banner">
            <span className="base-cap-banner-text">
                Your data is session-only — it will be cleared on logout.{' '}
                <button className="base-cap-banner-link" onClick={() => navigate('/pricing')}>
                    Upgrade or start a free trial
                </button>
                {' '}to keep your data.
            </span>
            {uploadCapReached && nextUploadAt && (
                <span className="base-cap-countdown">
                    Next upload in: <strong>{formatMs(msLeft)}</strong>
                </span>
            )}
        </div>
    );
}
