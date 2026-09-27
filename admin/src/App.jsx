import { useEffect, useRef, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getMe, logout } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import StartupScreen from './components/StartupScreen.jsx';
import LoginScreen from './screens/Auth/LoginScreen.jsx';
import SignupScreen from './screens/Auth/SignupScreen.jsx';
import ForgotPasswordScreen from './screens/Auth/ForgotPasswordScreen.jsx';
import UsersScreen from './screens/General/UsersScreen.jsx';
import RolesScreen from './screens/General/RolesScreen.jsx';
import AdminAccountsScreen from './screens/General/AdminAccountsScreen.jsx';
import UnlockScreen from './screens/General/UnlockScreen.jsx';
import ImpersonationLogScreen from './screens/General/ImpersonationLogScreen.jsx';
import CategoriesScreen from './screens/Cashflow/CategoriesScreen.jsx';
import UserTransactionsScreen from './screens/Cashflow/UserTransactionsScreen.jsx';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// auth states: 'loading' | 'login' | 'signup' | 'forgot' | 'denied' | 'ok'

function AdminApp({ user, onLogout }) {
    const caller = { id: user?.id, role: user?.role, level: user?.level ?? 0 };
    return (
        <div className="admin-layout">
            <Sidebar user={user} onLogout={onLogout} />
            <main className="admin-main">
                <Routes>
                    <Route path="/" element={<Navigate to="/general/users" replace />} />
                    <Route path="/general/users" element={<UsersScreen caller={caller} />} />
                    <Route path="/general/roles" element={<RolesScreen caller={caller} />} />
                    <Route path="/general/admin-accounts" element={<AdminAccountsScreen caller={caller} />} />
                    <Route path="/general/unlock" element={<UnlockScreen />} />
                    <Route path="/general/impersonation-log" element={<ImpersonationLogScreen />} />
                    <Route path="/cashflow/categories" element={<CategoriesScreen />} />
                    <Route path="/cashflow/user-transactions" element={<UserTransactionsScreen caller={caller} />} />
                    <Route path="*" element={<Navigate to="/general/users" replace />} />
                </Routes>
            </main>
        </div>
    );
}

function hasAdminAccess(data) {
    return data.role === 'owner' || (data.permissions || []).includes('admin.panel.view');
}

export default function App() {
    const [authState, setAuthState] = useState('loading');
    const [user, setUser] = useState(null);
    const idleTimerRef = useRef(null);

    function resetIdleTimer() {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(async () => {
            await logout();
            setUser(null);
            setAuthState('login');
        }, IDLE_TIMEOUT_MS);
    }

    useEffect(() => {
        getMe()
            .then(data => {
                if (hasAdminAccess(data)) {
                    setUser(data);
                    setAuthState('ok');
                } else {
                    setUser(data);
                    setAuthState('denied');
                }
            })
            .catch(() => setAuthState('login'));
    }, []);

    // Wire idle timeout while logged in
    useEffect(() => {
        if (authState !== 'ok') return;
        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        events.forEach(e => window.addEventListener(e, resetIdleTimer));
        resetIdleTimer();
        return () => {
            events.forEach(e => window.removeEventListener(e, resetIdleTimer));
            clearTimeout(idleTimerRef.current);
        };
    }, [authState]);

    function handleLoginSuccess(data) {
        setUser(data);
        setAuthState(hasAdminAccess(data) ? 'ok' : 'denied');
    }

    async function handleLogout() {
        await logout();
        setUser(null);
        setAuthState('login');
    }

    if (authState === 'loading') return <StartupScreen />;

    if (authState === 'login') {
        return (
            <LoginScreen
                onLogin={handleLoginSuccess}
                onGoSignup={() => setAuthState('signup')}
            />
        );
    }

    if (authState === 'signup') {
        return <SignupScreen onGoLogin={() => setAuthState('login')} />;
    }

    if (authState === 'forgot') {
        return <ForgotPasswordScreen onGoLogin={() => setAuthState('login')} />;
    }

    if (authState === 'denied') {
        return (
            <div className="admin-denied">
                <h2>Access denied</h2>
                <p>Your account doesn't have admin panel access.</p>
                <p style={{ fontSize: 13, marginTop: 4 }}>Logged in as: <strong>{user?.username || '—'}</strong></p>
                <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={handleLogout}>Sign out</button>
            </div>
        );
    }

    return (
        <HashRouter>
            <AdminApp user={user} onLogout={handleLogout} />
        </HashRouter>
    );
}
