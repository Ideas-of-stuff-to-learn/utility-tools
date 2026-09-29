import { useEffect, useState } from 'react';
import { useAuth } from '../appState';

const LOGIN_URL = import.meta.env.PROD
    ? '/utility-tools/login?redirect=/utility-tools/cashflow/'
    : 'http://localhost:5174/login';

// Landing's /login auto-forwards straight back here when its cookies look
// valid. If cashflow disagrees, that is an infinite ping-pong — so a second
// bounce inside this window stops and asks instead of redirecting again.
const BOUNCE_KEY = 'cashflow_login_bounce_at';
const BOUNCE_WINDOW_MS = 20000;

function readBounce() { try { return Number(sessionStorage.getItem(BOUNCE_KEY)) || 0; } catch { return 0; } }
function writeBounce() { try { sessionStorage.setItem(BOUNCE_KEY, String(Date.now())); } catch {} }
function clearBounce() { try { sessionStorage.removeItem(BOUNCE_KEY); } catch {} }

function goToLogin() {
    writeBounce();
    window.location.replace(LOGIN_URL);
}

function SessionProblem() {
    return (
        <div className="scroll-view">
            <div className="scroll-content">
                <div className="banner">
                    <p className="banner-text">We couldn't confirm your sign-in.</p>
                    <button className="btn" style={{ marginTop: 8, marginRight: 8 }} onClick={() => window.location.reload()}>Try again</button>
                    <button className="btn" style={{ marginTop: 8 }} onClick={goToLogin}>Sign in again</button>
                </div>
            </div>
        </div>
    );
}

// While auth is still 'checking' the app renders normally (chart area shows
// its loading bars) — there is no full-page startup screen in cashflow.
export default function RequireAuth({ children }) {
    const { status } = useAuth();
    const [blocked, setBlocked] = useState(false);

    useEffect(() => {
        if (status === 'authenticated') { clearBounce(); return; }
        if (status !== 'unauthenticated') return;
        if (Date.now() - readBounce() < BOUNCE_WINDOW_MS) { setBlocked(true); return; }
        goToLogin();
    }, [status]);

    if (status === 'unauthenticated') return blocked ? <SessionProblem /> : null;
    return children;
}
