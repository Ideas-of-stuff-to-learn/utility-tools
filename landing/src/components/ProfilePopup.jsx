import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { logout } from '../api';
import '../styles/ProfilePopup.css';

export default function ProfilePopup({ onClose }) {
    const { userRole, endSession } = useAuth();
    const navigate = useNavigate();
    const popupRef = useRef(null);

    useEffect(() => {
        function handleClick(e) {
            if (popupRef.current && !popupRef.current.contains(e.target)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    async function handleLogout() {
        onClose();
        await logout();
        endSession();
        navigate('/login', { replace: true });
    }

    function handleEditProfile() {
        onClose();
        navigate('/profile');
    }

    const displayName = userRole?.display_name || userRole?.username || '—';
    const email = userRole?.email;
    const emailVerified = userRole?.email_verified;
    const pendingEmail = userRole?.pending_email;
    const isAdmin = userRole?.role === 'owner' || (userRole?.permissions || []).includes('admin.panel.view');
    const adminUrl = import.meta.env.PROD
        ? 'https://ideas-of-stuff-to-learn.github.io/utility-tools/admin/'
        : `http://localhost:${import.meta.env.VITE_ADMIN_PORT || '5175'}/`;

    return (
        <div className="profile-popup" ref={popupRef}>
            <div className="profile-popup-name">{displayName}</div>
            {email ? (
                <div className="profile-popup-email">
                    {email}
                    {emailVerified
                        ? <span className="profile-email-badge verified">✓ verified</span>
                        : <span className="profile-email-badge unverified">unverified</span>}
                </div>
            ) : (
                <div className="profile-popup-email no-email">No email set</div>
            )}
            {pendingEmail && (
                <div className="profile-popup-pending">Pending: {pendingEmail}</div>
            )}
            <div className="profile-popup-divider" />
            <button className="profile-popup-btn" onClick={handleEditProfile}>Edit Profile</button>
            {isAdmin && (
                <a className="profile-popup-btn profile-popup-admin" href={adminUrl} target="_blank" rel="noreferrer">Admin Panel →</a>
            )}
            <button className="profile-popup-btn profile-popup-logout" onClick={handleLogout}>Sign out</button>
        </div>
    );
}
