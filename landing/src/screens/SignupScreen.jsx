import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { signup, safeRedirectTarget } from '../api';
import { useAuth } from '../AuthContext';
import '../styles/LoginScreen.css';

export default function SignupScreen() {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const { completeLogin } = useAuth();
    const navigate = useNavigate();

    async function handleSignup(e) {
        e.preventDefault();
        if (!username.trim() || !password.trim() || !confirmPassword.trim()) {
            setError('Please fill in all fields');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const trimmedUsername = username.trim();
            const trimmedEmail = email.trim() || undefined;
            await signup(trimmedUsername, password, trimmedEmail);
            completeLogin(trimmedUsername);
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

    return (
        <div className="login-container">
            <h1 className="login-title">Create Account</h1>
            <p className="login-subtitle">Sign up to get started</p>

            <form onSubmit={handleSignup}>
                <input
                    className="login-input"
                    placeholder="Username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                />

                <input
                    className="login-input"
                    placeholder="Email (optional)"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    type="email"
                    autoCapitalize="none"
                    autoComplete="email"
                />

                <input
                    className="login-input"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    type="password"
                />

                <input
                    className="login-input"
                    placeholder="Confirm Password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    type="password"
                />

                {error && <p className="login-error">{error}</p>}

                <button className="login-button" type="submit" disabled={loading}>
                    {loading ? '...' : 'Create Account'}
                </button>
            </form>

            <button className="login-switch" onClick={() => navigate('/login')}>
                Already have an account? Sign in
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
