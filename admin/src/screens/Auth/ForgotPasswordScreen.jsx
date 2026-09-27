export default function ForgotPasswordScreen({ onGoLogin }) {
    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-title">Admin Panel</div>
                <div className="auth-subtitle">Password reset</div>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '16px 0' }}>
                    Admin accounts are provisioned by the owner. To reset your password, contact the owner directly.
                </p>
                <div className="auth-links">
                    <button className="auth-link" onClick={onGoLogin}>← Back to sign in</button>
                </div>
            </div>
        </div>
    );
}
