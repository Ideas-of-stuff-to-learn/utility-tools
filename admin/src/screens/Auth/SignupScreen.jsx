export default function SignupScreen({ onGoLogin }) {
    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-title">Admin Panel</div>
                <div className="auth-subtitle">Admin accounts are provisioned by the owner</div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
                    To get access, ask the system owner to create an account for you from the Admin Accounts screen.
                </p>
                <div className="auth-links" style={{ marginTop: 24 }}>
                    <button className="auth-link" onClick={onGoLogin}>← Back to sign in</button>
                </div>
            </div>
        </div>
    );
}
