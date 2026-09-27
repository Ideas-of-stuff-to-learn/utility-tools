import { useState } from 'react';
import { loginStep1, loginStep2 } from '../../api.js';
import StartupScreen from '../../components/StartupScreen.jsx';
import { QRCodeSVG as QRCode } from 'qrcode.react';

// step: 'credentials' | 'totp' | 'enroll'
export default function LoginScreen({ onLogin }) {
    const [step, setStep] = useState('credentials');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [totpCode, setTotpCode] = useState('');
    const [tempToken, setTempToken] = useState('');
    const [totpUri, setTotpUri] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleCredentials(e) {
        e.preventDefault();
        setError(''); setLoading(true);
        try {
            const data = await loginStep1(username, password);
            setTempToken(data.temp_token);
            if (data.step === 'enroll') {
                setTotpUri(data.totp_uri || '');
                setStep('enroll');
            } else {
                setStep('totp');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleTOTP(e) {
        e.preventDefault();
        setError(''); setLoading(true);
        try {
            const data = await loginStep2(tempToken, totpCode);
            onLogin(data);
        } catch (err) {
            setError(err.message);
            setTotpCode('');
        } finally {
            setLoading(false);
        }
    }

    if (loading) return <StartupScreen />;

    if (step === 'credentials') {
        return (
            <div className="auth-page">
                <div className="auth-card">
                    <div className="auth-title">Admin Panel</div>
                    <div className="auth-subtitle">Sign in to your account</div>
                    {error && <div className="auth-error">{error}</div>}
                    <form onSubmit={handleCredentials}>
                        <div className="form-row">
                            <label className="form-label">Username</label>
                            <input
                                className="admin-input"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                autoComplete="username"
                                required
                            />
                        </div>
                        <div className="form-row">
                            <label className="form-label">Password</label>
                            <input
                                className="admin-input"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                autoComplete="current-password"
                                required
                            />
                        </div>
                        <button className="btn btn-primary auth-submit" type="submit">
                            Continue
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    if (step === 'enroll') {
        return (
            <div className="auth-page">
                <div className="auth-card">
                    <div className="auth-title">Set up authenticator</div>
                    <div className="auth-subtitle">
                        Scan this QR code with Google Authenticator or Authy, then enter the 6-digit code below.
                    </div>
                    {totpUri && (
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0' }}>
                            <QRCode value={totpUri} size={180} />
                        </div>
                    )}
                    {error && <div className="auth-error">{error}</div>}
                    <form onSubmit={handleTOTP}>
                        <div className="form-row">
                            <label className="form-label">Authenticator code</label>
                            <input
                                className="admin-input"
                                value={totpCode}
                                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                placeholder="000000"
                                required
                            />
                        </div>
                        <button className="btn btn-primary auth-submit" type="submit" disabled={totpCode.length !== 6}>
                            Verify and sign in
                        </button>
                    </form>
                    <div className="auth-links">
                        <button className="auth-link" onClick={() => { setStep('credentials'); setError(''); }}>
                            ← Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // step === 'totp'
    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-title">Admin Panel</div>
                <div className="auth-subtitle">Enter the 6-digit code from your authenticator app</div>
                {error && <div className="auth-error">{error}</div>}
                <form onSubmit={handleTOTP}>
                    <div className="form-row">
                        <label className="form-label">Authenticator code</label>
                        <input
                            className="admin-input"
                            value={totpCode}
                            onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            placeholder="000000"
                            autoFocus
                            required
                        />
                    </div>
                    <button className="btn btn-primary auth-submit" type="submit" disabled={totpCode.length !== 6}>
                        Sign in
                    </button>
                </form>
                <div className="auth-links">
                    <button className="auth-link" onClick={() => { setStep('credentials'); setError(''); setTotpCode(''); }}>
                        ← Back
                    </button>
                </div>
            </div>
        </div>
    );
}
