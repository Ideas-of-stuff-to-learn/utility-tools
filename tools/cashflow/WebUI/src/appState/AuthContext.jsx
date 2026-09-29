import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { primeGetMe } from '../api';

const AuthContext = createContext();

const HINT_KEY = 'auth_hint';
function readHint() { try { return sessionStorage.getItem(HINT_KEY) === '1'; } catch { return false; } }
function setHint() { try { sessionStorage.setItem(HINT_KEY, '1'); } catch {} }
function clearHint() { try { sessionStorage.removeItem(HINT_KEY); } catch {} }

export function AuthProvider({ children }) {
    const hasHint = readHint();

    const [isLoggedIn, setIsLoggedIn] = useState(hasHint);
    const [isChecking, setIsChecking] = useState(!hasHint);
    const [userRole, setUserRole] = useState(null);
    // idbReady: true once getMe() has resolved AND _setIdbKey has run.
    // Use this (not isLoggedIn) to gate IDB reads — isLoggedIn can be
    // true from the sessionStorage hint before the crypto key is set.
    const [idbReady, setIdbReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        primeGetMe()
            .then(data => {
                if (cancelled) return;
                setUserRole(data);
                setIsLoggedIn(true);
                setHint();
                // getMe() calls _setIdbKey internally before returning,
                // so by the time we reach here the crypto key is set.
                setIdbReady(true);
            })
            .catch(() => {
                if (cancelled) return;
                setIsLoggedIn(false);
                setIdbReady(false);
                clearHint();
            })
            .finally(() => {
                if (!cancelled) setIsChecking(false);
            });
        return () => { cancelled = true; };
    }, []);

    // Called by LoginScreen/SignupScreen after a successful login response.
    // The login API call sets the IDB crypto key before returning, so by
    // the time completeLogin is invoked the key is already in place.
    const completeLogin = useCallback((role) => {
        setUserRole(role ?? null);
        setIsLoggedIn(true);
        setIdbReady(true);
        setHint();
    }, []);

    const endSession = useCallback(() => {
        setIsLoggedIn(false);
        setIdbReady(false);
        setUserRole(null);
        clearHint();
    }, []);

    useEffect(() => {
        function handleExpired() {
            setIsLoggedIn(false);
            setIdbReady(false);
            setUserRole(null);
            clearHint();
        }
        window.addEventListener('auth:session-expired', handleExpired);
        return () => window.removeEventListener('auth:session-expired', handleExpired);
    }, []);

    return (
        <AuthContext.Provider value={{ isLoggedIn, isChecking, userRole, endSession, idbReady, completeLogin }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
