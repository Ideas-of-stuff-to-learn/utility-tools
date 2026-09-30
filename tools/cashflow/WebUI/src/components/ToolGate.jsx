import { useBilling } from '../appState/BillingContext';
import { useAuth } from '../appState/AuthContext';

/**
 * Wraps any tool screen. All users enter — base users see the app but
 * with upload locked when they've hit their daily cap.
 * The upload-locked state is handled inside ActionButtons.
 */
export default function ToolGate({ children }) {
    const { isChecking }  = useAuth();
    const { billing }     = useBilling();

    // While auth is still resolving, render nothing (avoid flash)
    if (isChecking || billing === null) return null;

    return children;
}
