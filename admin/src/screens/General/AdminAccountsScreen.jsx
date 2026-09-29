import { useEffect, useState } from 'react';
import {
    getAdminAccounts, createAdminAccount, deleteAdminAccount, editAdminAccount, resetAdminMfa,
    getRoles, getUsers, createUserAccount, deleteUserAccount,
} from '../../api.js';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal.jsx';

// ── Shared helpers ─────────────────────────────────────────────────────────────

const MIN_LEVEL     = parseInt(import.meta.env.VITE_ADMIN_ACCOUNT_MIN_LEVEL ?? '30', 10);

// ── Admin account modals ───────────────────────────────────────────────────────

function CreateAdminModal({ roles, caller, onSave, onClose }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [roleName, setRoleName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const availableRoles = roles.filter(r => r.level < caller.level && r.level >= MIN_LEVEL);

    async function handleSave(e) {
        e.preventDefault();
        if (!roleName) { setError('Select a role'); return; }
        setSaving(true); setError('');
        try {
            await onSave(username, password, roleName);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 440 }}>
                <div className="modal-title">Create admin account</div>
                {error && <div className="screen-error">{error}</div>}
                <form onSubmit={handleSave}>
                    <div className="form-row">
                        <label className="form-label">Username</label>
                        <input className="admin-input" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={32} />
                    </div>
                    <div className="form-row">
                        <label className="form-label">Password</label>
                        <input className="admin-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Min 8 characters</div>
                    </div>
                    <div className="form-row">
                        <label className="form-label">Role</label>
                        <select className="admin-input" value={roleName} onChange={e => setRoleName(e.target.value)} required>
                            <option value="">Select a role…</option>
                            {availableRoles.map(r => (
                                <option key={r.id} value={r.name}>{r.name} (level {r.level})</option>
                            ))}
                        </select>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function EditAdminRoleModal({ acc, roles, caller, onSave, onClose }) {
    const availableRoles = roles.filter(r => r.level < caller.level && r.level >= MIN_LEVEL);
    const [roleName, setRoleName] = useState(acc.role || '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    async function handleSave(e) {
        e.preventDefault();
        if (!roleName) { setError('Select a role'); return; }
        setSaving(true); setError('');
        try {
            await onSave(acc.id, roleName);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 400 }}>
                <div className="modal-title">Edit role — {acc.username}</div>
                {error && <div className="screen-error">{error}</div>}
                <form onSubmit={handleSave}>
                    <div className="form-row">
                        <label className="form-label">Role</label>
                        <select className="admin-input" value={roleName} onChange={e => setRoleName(e.target.value)} required>
                            <option value="">Select a role…</option>
                            {availableRoles.map(r => (
                                <option key={r.id} value={r.name}>{r.name} (level {r.level})</option>
                            ))}
                        </select>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ── User account modal ─────────────────────────────────────────────────────────

function CreateUserModal({ roles, caller, onSave, onClose }) {
    const [username, setUsername] = useState('');
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [roleName, setRoleName] = useState('');
    const [saving, setSaving]     = useState(false);
    const [error, setError]       = useState('');

    // User-level roles: 0 < level < MIN_LEVEL, and below caller's level
    const availableRoles = roles.filter(r => r.level > 0 && r.level < MIN_LEVEL && r.level < caller.level);

    async function handleSave(e) {
        e.preventDefault();
        if (!roleName) { setError('Select a role'); return; }
        setSaving(true); setError('');
        try {
            await onSave(username, email, password, roleName);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 440 }}>
                <div className="modal-title">Create user account</div>
                {error && <div className="screen-error">{error}</div>}
                <form onSubmit={handleSave}>
                    <div className="form-row">
                        <label className="form-label">Username</label>
                        <input className="admin-input" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={32} />
                    </div>
                    <div className="form-row">
                        <label className="form-label">Email <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(optional)</span></label>
                        <input className="admin-input" type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} />
                    </div>
                    <div className="form-row">
                        <label className="form-label">Password</label>
                        <input className="admin-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Min 8 characters</div>
                    </div>
                    <div className="form-row">
                        <label className="form-label">Role</label>
                        <select className="admin-input" value={roleName} onChange={e => setRoleName(e.target.value)} required>
                            <option value="">Select a role…</option>
                            {availableRoles.map(r => (
                                <option key={r.id} value={r.name}>{r.name} (level {r.level})</option>
                            ))}
                        </select>
                        {availableRoles.length === 0 && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                No user-level roles available (level 1–{MIN_LEVEL - 1} below your level {caller.level})
                            </div>
                        )}
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={saving || availableRoles.length === 0}>
                            {saving ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function AdminAccountsScreen({ caller = { role: 'user', level: 0 } }) {
    const [tab, setTab]                   = useState('admin'); // 'admin' | 'users'

    // Admin accounts state
    const [adminAccounts, setAdminAccounts] = useState([]);
    const [showCreateAdmin, setShowCreateAdmin] = useState(false);
    const [editTarget, setEditTarget]     = useState(null);
    const [adminDeleteTarget, setAdminDeleteTarget] = useState(null);
    const [mfaResetTarget, setMfaResetTarget]       = useState(null);

    // User accounts state
    const [userAccounts, setUserAccounts] = useState([]);
    const [showCreateUser, setShowCreateUser]       = useState(false);
    const [userDeleteTarget, setUserDeleteTarget]   = useState(null);

    // Shared
    const [roles, setRoles]         = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [success, setSuccess]     = useState('');

    useEffect(() => {
        Promise.all([getAdminAccounts(), getRoles(), getUsers()])
            .then(([accs, r, users]) => {
                setAdminAccounts(accs);
                setRoles(r);
                // Show only elevated user accounts (0 < level < MIN_LEVEL, below caller)
                setUserAccounts(users.filter(u => u.level > 0 && u.level < MIN_LEVEL));
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    // ── Admin account handlers ────────────────────────────────────────────────

    async function handleCreateAdmin(username, password, roleName) {
        const acc = await createAdminAccount(username, password, roleName);
        setAdminAccounts(prev => [...prev, acc]);
        setSuccess(`Admin account "${username}" created.`);
    }

    async function handleEditRole(id, roleName) {
        const updated = await editAdminAccount(id, { role: roleName });
        setAdminAccounts(prev => prev.map(a => a.id === id ? { ...a, role: updated.role, level: updated.level } : a));
        setSuccess(`Role updated for "${updated.username}"`);
    }

    async function confirmDeleteAdmin(acc) {
        setError(''); setSuccess('');
        try {
            await deleteAdminAccount(acc.id);
            setAdminAccounts(prev => prev.filter(a => a.id !== acc.id));
            setSuccess(`Admin account "${acc.username}" deleted`);
        } catch (e) {
            setError(e.message);
        } finally {
            setAdminDeleteTarget(null);
        }
    }

    async function confirmResetMfa(acc) {
        setError(''); setSuccess('');
        try {
            await resetAdminMfa(acc.id);
            setAdminAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, totp_enrolled: false } : a));
            setSuccess(`MFA reset for "${acc.username}" — they will re-enrol on next login`);
        } catch (e) {
            setError(e.message);
        } finally {
            setMfaResetTarget(null);
        }
    }

    // ── User account handlers ─────────────────────────────────────────────────

    async function handleCreateUser(username, email, password, roleName) {
        const user = await createUserAccount(username, email, password, roleName);
        setUserAccounts(prev => [...prev, user]);
        setSuccess(`User account "${username}" created.`);
    }

    async function confirmDeleteUser(user) {
        setError(''); setSuccess('');
        try {
            await deleteUserAccount(user.id);
            setUserAccounts(prev => prev.filter(u => u.id !== user.id));
            setSuccess(`User account "${user.username}" deleted`);
        } catch (e) {
            setError(e.message);
        } finally {
            setUserDeleteTarget(null);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div>
            <h1 className="screen-title">Accounts</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                Manage admin panel accounts and elevated Cashflow user accounts.
            </p>

            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
                {[
                    { key: 'admin', label: 'Admin Accounts' },
                    { key: 'users', label: 'User Accounts' },
                ].map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => { setTab(key); setError(''); setSuccess(''); }}
                        style={{
                            background: 'none',
                            border: 'none',
                            borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
                            color: tab === key ? 'var(--text)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '8px 16px',
                            fontSize: 13,
                            fontWeight: tab === key ? 600 : 400,
                            marginBottom: -1,
                        }}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {error   && <div className="screen-error">{error}</div>}
            {success && <div className="screen-success">{success}</div>}

            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
                <>
                    {/* ── Admin Accounts tab ──────────────────────────────────── */}
                    {tab === 'admin' && (
                        <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
                                These accounts are separate from Cashflow user accounts. Credentials here cannot be used on the Cashflow app. Level ≥ {MIN_LEVEL}.
                            </p>
                            <div style={{ marginBottom: 16 }}>
                                <button className="btn btn-primary" onClick={() => setShowCreateAdmin(true)}>+ New account</button>
                            </div>
                            <div className="admin-table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Role</th>
                                            <th>MFA</th>
                                            <th>Last login</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {adminAccounts.map(acc => {
                                            const canAct = acc.id !== caller.id && acc.level < caller.level;
                                            return (
                                                <tr key={acc.id}>
                                                    <td style={{ fontWeight: 600 }}>{acc.username}</td>
                                                    <td>{acc.role || '—'} {acc.level != null && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(level {acc.level})</span>}</td>
                                                    <td>
                                                        {acc.totp_enrolled
                                                            ? <span style={{ color: 'var(--success, #22c55e)', fontSize: 12 }}>✓ enrolled</span>
                                                            : <span style={{ color: 'var(--warning, #f59e0b)', fontSize: 12 }}>⏳ pending</span>}
                                                    </td>
                                                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                                        {acc.last_login_at ? new Date(acc.last_login_at).toLocaleString() : 'Never'}
                                                    </td>
                                                    <td>
                                                        {canAct ? (
                                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                                <button className="btn btn-secondary btn-sm" onClick={() => setEditTarget(acc)}>Edit</button>
                                                                <button className="btn btn-secondary btn-sm" onClick={() => setMfaResetTarget(acc)}>Reset MFA</button>
                                                                <button className="btn btn-danger btn-sm" onClick={() => setAdminDeleteTarget(acc)}>Delete</button>
                                                            </div>
                                                        ) : acc.id !== caller.id ? (
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not authorised to edit</span>
                                                        ) : (
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {adminAccounts.length === 0 && (
                                            <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No admin accounts yet</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── User Accounts tab ───────────────────────────────────── */}
                    {tab === 'users' && (
                        <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
                                Cashflow user accounts with an elevated role (level 1–{MIN_LEVEL - 1}). Default-level users (level 0) are visible in the Users screen.
                            </p>
                            <div style={{ marginBottom: 16 }}>
                                <button className="btn btn-primary" onClick={() => setShowCreateUser(true)}>+ New account</button>
                            </div>
                            <div className="admin-table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Username</th>
                                            <th>Email</th>
                                            <th>Role</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userAccounts.map(user => {
                                            const canAct = user.level < caller.level;
                                            return (
                                                <tr key={user.id}>
                                                    <td style={{ fontWeight: 600 }}>{user.username}</td>
                                                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.email || '—'}</td>
                                                    <td>
                                                        {user.role || '—'}
                                                        {user.level != null && (
                                                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (level {user.level})</span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {canAct ? (
                                                            <button className="btn btn-danger btn-sm" onClick={() => setUserDeleteTarget(user)}>Delete</button>
                                                        ) : (
                                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not authorised</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {userAccounts.length === 0 && (
                                            <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No elevated user accounts yet</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Admin modals ──────────────────────────────────────────────── */}
            {showCreateAdmin && (
                <CreateAdminModal
                    roles={roles}
                    caller={caller}
                    onSave={handleCreateAdmin}
                    onClose={() => setShowCreateAdmin(false)}
                />
            )}
            {editTarget && (
                <EditAdminRoleModal
                    acc={editTarget}
                    roles={roles}
                    caller={caller}
                    onSave={handleEditRole}
                    onClose={() => setEditTarget(null)}
                />
            )}
            {adminDeleteTarget && (
                <ConfirmDeleteModal
                    message={`Delete admin account "${adminDeleteTarget.username}"? This cannot be undone.`}
                    onConfirm={() => confirmDeleteAdmin(adminDeleteTarget)}
                    onCancel={() => setAdminDeleteTarget(null)}
                />
            )}
            {mfaResetTarget && (
                <ConfirmDeleteModal
                    message={`Reset MFA for "${mfaResetTarget.username}"? They will be required to re-enrol their authenticator on next login.`}
                    onConfirm={() => confirmResetMfa(mfaResetTarget)}
                    onCancel={() => setMfaResetTarget(null)}
                />
            )}

            {/* ── User modals ───────────────────────────────────────────────── */}
            {showCreateUser && (
                <CreateUserModal
                    roles={roles}
                    caller={caller}
                    onSave={handleCreateUser}
                    onClose={() => setShowCreateUser(false)}
                />
            )}
            {userDeleteTarget && (
                <ConfirmDeleteModal
                    message={`Delete user account "${userDeleteTarget.username}"? All their transactions and data will be permanently removed.`}
                    onConfirm={() => confirmDeleteUser(userDeleteTarget)}
                    onCancel={() => setUserDeleteTarget(null)}
                />
            )}
        </div>
    );
}
