import { useNavigate } from 'react-router-dom';
import { useBilling } from '../appState/BillingContext';
import { useAuth } from '../appState/AuthContext';
import '../styles/billing.css';

/**
 * Wraps any tool screen. If the user doesn't have pro access (active sub
 * or active trial), shows a gate screen prompting them to start a trial.
 * If the user has pro, renders children as normal.
 */
export default function ToolGate({ tool = 'cashflow', children }) {
    const { isChecking }  = useAuth();
    const { hasPro, billing } = useBilling();
    const navigate = useNavigate();

    // While auth is still resolving, render nothing (avoid flash of gate)
    if (isChecking || billing === null) return null;

    if (hasPro) return children;

    return (
        <div className="tool-gate">
            <div className="tool-gate-icon">📊</div>
            <h2>Start your free trial</h2>
            <p>
                Get {30} days of full Cashflow access — transaction tracking,
                charts, and auto-categorisation — completely free.
            </p>
            <div className="tool-gate-actions">
                <button
                    className="btn-primary"
                    onClick={() => navigate('/pricing')}
                >
                    See plans &amp; start trial
                </button>
            </div>
        </div>
    );
}
