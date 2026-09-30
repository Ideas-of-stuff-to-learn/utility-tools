import { NavLink } from 'react-router-dom';

const LANDING_URL = import.meta.env.PROD
    ? 'https://ideas-of-stuff-to-learn.github.io/utility-tools/'
    : 'http://localhost:5174/';

const AUDIT_MIN = parseInt(import.meta.env.VITE_ADMIN_AUDIT_MIN_LEVEL ?? '60', 10);
const GEO_LOG_MIN = 1; // any admin (level ≥ 1) can see geo logs

export default function Sidebar({ user, onLogout }) {
    const displayName = user?.display_name || user?.username || '—';
    const role = user?.role || '';
    const level = user?.level ?? 0;
    const canSeeAudit  = user?.role === 'owner' || level >= AUDIT_MIN;
    const canSeeGeoLog = user?.role === 'owner' || level >= GEO_LOG_MIN;
    const perms = user?.permissions || [];
    const canManageAccounts = user?.role === 'owner' || perms.includes('admin.accounts.manage');

    return (
        <nav className="admin-sidebar">
            <div className="admin-sidebar-header">
                <span className="admin-sidebar-title">Admin Panel</span>
                <span className="admin-sidebar-role">{role}</span>
            </div>

            <div className="admin-sidebar-user">{displayName}</div>

            <div className="admin-sidebar-section">General</div>
            <NavLink className="admin-nav-item" to="/general/users">Users</NavLink>
            <NavLink className="admin-nav-item" to="/general/roles">Roles &amp; Permissions</NavLink>
            {canManageAccounts && <NavLink className="admin-nav-item" to="/general/admin-accounts">Admin Accounts</NavLink>}
            {canManageAccounts && <NavLink className="admin-nav-item" to="/general/user-accounts">User Accounts</NavLink>}
            <NavLink className="admin-nav-item" to="/general/unlock">Unlock Account</NavLink>
            {canSeeAudit  && <NavLink className="admin-nav-item" to="/general/impersonation-log">Impersonation Log</NavLink>}
            {canSeeAudit  && <NavLink className="admin-nav-item" to="/general/audit-log">Audit Log</NavLink>}
            {canSeeGeoLog && <NavLink className="admin-nav-item" to="/general/geo-logs">Geo Logs</NavLink>}
            <NavLink className="admin-nav-item" to="/general/failed-calls">Failed Network Calls</NavLink>

            <div className="admin-sidebar-section">Cashflow</div>
            <NavLink className="admin-nav-item" to="/cashflow/categories">Categories</NavLink>
            <NavLink className="admin-nav-item" to="/cashflow/user-transactions">User Transactions</NavLink>

            <div className="admin-sidebar-section">Billing</div>
            <NavLink className="admin-nav-item" to="/billing/settings">Billing Settings</NavLink>
            <NavLink className="admin-nav-item" to="/billing/ip-management">IP Management</NavLink>

            <div style={{ marginTop: 'auto', padding: '12px 16px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={onLogout}>Sign out</button>
                <a className="admin-nav-back" href={LANDING_URL}>← Back to utility-tools</a>
            </div>
        </nav>
    );
}
