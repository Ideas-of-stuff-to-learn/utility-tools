import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function BaseCapBanner() {
    const navigate = useNavigate();
    const { hasPro, uploadCapReached, nextUploadAt } = useBilling();
    const msLeft = useCountdown(uploadCapReached ? nextUploadAt : null);

    if (hasPro) return null;

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
