import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { bootstrapSession, isAuthFailure } from '../api';

const AuthContext = createContext();

// Landing shares this sessionStorage key (same origin); cashflow only
// clears it so landing doesn't briefly render a dead session as live.
function clearLandingHint() { try { sessionStorage.removeItem('auth_hint'); } catch {} }

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const SLOW_AFTER_MS = 6000;

function isDefinitiveAuthFailure(err) {
    return isAuthFailure(err) || err?.status === 401 || err?.status === 403 || err?.status === 422;
}

// status: 'checking' → 'authenticated' | 'unauthenticated'.
// Only a rejected session moves to 'unauthenticated'. 429 / 5xx / timeouts /
// offline keep retrying in the background with the app shell on screen —
// treating those as a logout is what used to bounce users through the
// landing login page and back.
export function AuthProvider({ children }) {
    const [status, setStatus] = useState('checking');
    const [userRole, setUserRole] = useState(null);
    // idbReady: getMe() resolved AND the IDB crypto key is imported.
    const [idbReady, setIdbReady] = useState(false);
    const [connectionSlow, setConnectionSlow] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let retryTimer = null;
        let attempt = 0;
        const slowTimer = setTimeout(() => { if (!cancelled) setConnectionSlow(true); }, SLOW_AFTER_MS);

        function run() {
            clearTimeout(retryTimer);
            retryTimer = null;
            bootstrapSession()
                .then(data => {
                    if (cancelled) return;
                    clearTimeout(slowTimer);
                    setUserRole(data);
                    setStatus('authenticated');
                    setIdbReady(true);
                    setConnectionSlow(false);
                })
                .catch(err => {
                    if (cancelled) return;
                    if (isDefinitiveAuthFailure(err)) {
                        clearTimeout(slowTimer);
                        clearLandingHint();
                        setStatus('unauthenticated');
                        return;
                    }
                    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
                    attempt++;
                    retryTimer = setTimeout(run, delay);
                });
        }

        function retryNow() { if (retryTimer) run(); }

        run();
        window.addEventListener('online', retryNow);
        return () => {
            cancelled = true;
            clearTimeout(retryTimer);
            clearTimeout(slowTimer);
            window.removeEventListener('online', retryNow);
        };
    }, []);

    // Called by LoginScreen/SignupScreen after a successful login response.
    // The login API call sets the IDB crypto key before returning.
    const completeLogin = useCallback((role) => {
        setUserRole(role ?? null);
        setStatus('authenticated');
        setIdbReady(true);
    }, []);

    const endSession = useCallback(() => {
        setStatus('unauthenticated');
        setIdbReady(false);
        setUserRole(null);
        clearLandingHint();
    }, []);

    useEffect(() => {
        window.addEventListener('auth:session-expired', endSession);
        return () => window.removeEventListener('auth:session-expired', endSession);
    }, [endSession]);

    return (
        <AuthContext.Provider value={{
            status,
            isLoggedIn: status === 'authenticated',
            isChecking: status === 'checking',
            connectionSlow,
            userRole, idbReady,
            completeLogin, endSession,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
