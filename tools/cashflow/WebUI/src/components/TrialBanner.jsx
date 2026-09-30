import { useNavigate } from 'react-router-dom';
import { useBilling } from '../appState/BillingContext';
import '../styles/billing.css';

/**
 * Shown at the top of tool screens when the user is in an active trial.
 * Disappears once they're on a paid plan or the trial ends.
 */
export default function TrialBanner() {
    const { activeTrial, paymentFailed } = useBilling();
    const navigate = useNavigate();

    if (paymentFailed) {
        return (
            <div className="payment-failed-banner">
                <span><strong>Payment failed.</strong> Update your card to keep your access.</span>
                <button className="btn-secondary" onClick={() => navigate('/card-setup')}>
                    Update card
                </button>
            </div>
        );
    }

    if (!activeTrial) return null;

    const endsAt   = new Date(activeTrial.ends_at);
    const daysLeft = Math.max(0, Math.ceil((endsAt - Date.now()) / 86400000));

    return (
        <div className="trial-banner">
            <span>
                <strong>Free trial</strong> — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
                {' '}(ends {endsAt.toLocaleDateString()})
            </span>
            <div className="trial-banner-actions">
                <button
                    className="btn-primary"
                    style={{ fontSize: 'var(--font-size-xs)', padding: '4px 12px' }}
                    onClick={() => navigate('/pricing')}
                >
                    Upgrade
                </button>
            </div>
        </div>
    );
}
