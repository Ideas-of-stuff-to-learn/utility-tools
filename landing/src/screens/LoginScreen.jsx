import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login, getMe, safeRedirectTarget } from '../api';
import { useAuth } from '../AuthContext';
import '../styles/LoginScreen.css';
import StartupScreen from '../components/StartupScreen';

// Progress bar easing: returns a % target given elapsed seconds.
// Deliberately slows near the top — bar sits at ~93% until getMe() responds.
function wakeupProgress(elapsedSeconds) {
    if (elapsedSeconds < 5)  return 4 + elapsedSeconds * 5.2;        // 4→30%
    if (elapsedSeconds < 15) return 30 + (elapsedSeconds - 5) * 4;   // 30→70%
    if (elapsedSeconds < 35) return 70 + (elapsedSeconds - 15) * 1;  // 70→90%
    return 90 + Math.min(3, (elapsedSeconds - 35) * 0.15);           // 90→93%, crawl
}

// Ordered boot stage messages — enough to cover up to 2 minutes at 3.5s each.
const WAKEUP_STAGES = [
    'Starting up…',
    'Preparing server…',
    'Establishing secure connection…',
    'Loading application data…',
    'Running startup checks…',
    'Setting up services…',
    'Initialising core systems…',
    'Configuring application…',
    'Loading user services…',
    'Preparing data layer…',
    'Verifying system integrity…',
    'Setting up secure session handling…',
    'Loading transaction services…',
    'Preparing categorisation engine…',
    'Bringing services online…',
    'Completing system checks…',
    'Finalising configuration…',
    'Almost there…',
    'Activating services…',
    'Loading your workspace…',
    'Warming up…',
    'Checking service health…',
    'Preparing your environment…',
    'Systems coming online…',
    'Synchronising services…',
    'Nearly ready…',
    'Finishing startup sequence…',
    'Last few checks…',
    'Getting things ready for you…',
    'Applying final configuration…',
    'Services are responding…',
    'Just a moment longer…',
    'Almost ready now…',
    'Hang tight…',
    'Wrapping up…',
];

export default function LoginScreen() {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const pageLoadRef = useRef(Date.now());
    const [checkingStoredSession, setCheckingStoredSession] = useState(true);
    const [retryCount, setRetryCount] = useState(0);
    const [isSlowStart, setIsSlowStart] = useState(false);
    const [progress, setProgress] = useState(0);
    const [spinnerFading, setSpinnerFading] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [stageIndex, setStageIndex] = useState(0);
    const wakeupStartRef = useRef(null);
    const progressRafRef = useRef(null);
    const stageIntervalRef = useRef(null);
    const { completeLogin } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        let cancelled = false;
        setError(null);
        setCheckingStoredSession(true);
        setIsSlowStart(false);
        setProgress(0);
        setSpinnerFading(false);
        setCompleting(false);
        setStageIndex(0);

        const slowTimer = setTimeout(() => {
            if (cancelled) return;
            setSpinnerFading(true);
            setTimeout(() => {
                if (cancelled) return;
                setIsSlowStart(true);
                wakeupStartRef.current = Date.now();
                function tick() {
                    if (cancelled) return;
                    const elapsed = (Date.now() - wakeupStartRef.current) / 1000;
                    setProgress(wakeupProgress(elapsed));
                    progressRafRef.current = requestAnimationFrame(tick);
                }
                progressRafRef.current = requestAnimationFrame(tick);
                stageIntervalRef.current = setInterval(() => {
                    setStageIndex(i => (i + 1) % WAKEUP_STAGES.length);
                }, 3500);
            }, 400);
        }, 3500);

        async function checkStoredSession() {
            try {
                const me = await getMe();
                if (cancelled) return;
                if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
                setCompleting(true);
                setProgress(100);
                setTimeout(() => {
                    if (cancelled) return;
                    completeLogin(me.username);
                    const redirect = safeRedirectTarget(new URLSearchParams(window.location.search).get('redirect'));
                    if (redirect) {
                        window.location.href = redirect;
                    } else {
                        navigate('/', { replace: true });
                    }
                }, 1300);
            } catch (e) {
                if (cancelled) return;
                const msg = e.message || '';
                if (msg.includes('starting up')) {
                    setError(msg);
                } else {
                    console.log('[startup] No usable stored session:', msg);
                }
                setCheckingStoredSession(false);
            } finally {
                clearTimeout(slowTimer);
                if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
                if (stageIntervalRef.current) clearInterval(stageIntervalRef.current);
            }
        }

        checkStoredSession();
        return () => {
            cancelled = true;
            clearTimeout(slowTimer);
            if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
            if (stageIntervalRef.current) clearInterval(stageIntervalRef.current);
        };
    }, [retryCount]);

    async function handleLogin(e) {
        e.preventDefault();
        if (!identifier.trim() || !password.trim()) {
            setError('Please enter your email or username and password');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            await login(identifier.trim(), password, Date.now() - pageLoadRef.current);
            completeLogin(identifier.trim());
            const redirect = safeRedirectTarget(new URLSearchParams(window.location.search).get('redirect'));
            if (redirect) {
                window.location.href = redirect;
            } else {
                navigate('/');
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    if (checkingStoredSession) {
        return (
            <div className="login-container">
                <h1 className="login-title">Utility Tools</h1>
                {error ? (
                    <>
                        <p className="login-error" style={{ textAlign: 'center', marginTop: 24 }}>{error}</p>
                        <button className="login-button" style={{ marginTop: 16, maxWidth: 280 }} onClick={() => setRetryCount(c => c + 1)}>
                            Retry
                        </button>
                    </>
                ) : isSlowStart ? (
                    <div className={`login-wakeup-wrap login-wakeup-fade-in${completing ? ' login-wakeup-done' : ''}`}>
                        <p className="login-wakeup-msg">
                            Server is waking up…
                            <span>This can take up to 2 minutes on first load</span>
                        </p>
                        <div className="login-progress-bar-row">
                            <div className="login-progress-track">
                                <div
                                    className={`login-progress-fill${completing ? ' login-progress-fill-complete' : ''}`}
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="login-progress-pct">{Math.round(progress)}%</span>
                        </div>
                        <p key={completing ? 'done' : stageIndex} className="login-progress-stage">{completing ? 'Done' : WAKEUP_STAGES[stageIndex]}</p>
                    </div>
                ) : (
                    <div className="login-loading-wrap">
                        <div className={`login-spinner-ring${spinnerFading ? ' login-spinner-fade-out' : ''}`} />
                    </div>
                )}
            </div>
        );
    }

    if (loading) {
        return <StartupScreen />;
    }

    return (
        <div className="login-container">
            <h1 className="login-title">Utility Tools</h1>
            <p className="login-subtitle">Sign in to continue</p>

            <form onSubmit={handleLogin}>
                {/* Honeypot — hidden from real users, bots fill it */}
                <input
                    name="website"
                    type="text"
                    autoComplete="off"
                    tabIndex={-1}
                    style={{ display: 'none' }}
                    aria-hidden="true"
                />

                <input
                    className="login-input"
                    placeholder="Email or username"
                    value={identifier}
                    onChange={e => setIdentifier(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="username"
                />

                <input
                    className="login-input"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    type="password"
                />

                {error && <p className="login-error">{error}</p>}

                <button className="login-button" type="submit" disabled={loading}>
                    {loading ? '...' : 'Sign in'}
                </button>
            </form>

            <button className="login-switch login-forgot" onClick={() => navigate('/forgot-password')}>
                Forgot password?
            </button>

            <button className="login-switch" onClick={() => navigate('/signup')}>
                Don't have an account? Sign up
            </button>

            <footer className="login-legal-footer">
                <Link to="/privacy">Privacy</Link>
                <Link to="/terms">Terms</Link>
                <Link to="/accessibility">Accessibility</Link>
                <Link to="/cookies">Cookies</Link>
            </footer>
        </div>
    );
}
