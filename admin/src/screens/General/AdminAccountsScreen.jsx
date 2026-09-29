import { useEffect, useState } from 'react';
import {
    getAdminAccounts, createAdminAccount, deleteAdminAccount, editAdminAccount, resetAdminMfa,
    getRoles,
} from '../../api.js';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal.jsx';

const MIN_LEVEL = parseInt(import.meta.env.VITE_ADMIN_ACCOUNT_MIN_LEVEL ?? '30', 10);

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

export default function AdminAccountsScreen({ caller = { role: 'user', level: 0 } }) {
    const [accounts, setAccounts] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [mfaResetTarget, setMfaResetTarget] = useState(null);

    useEffect(() => {
        Promise.all([getAdminAccounts(), getRoles()])
            .then(([accs, r]) => { setAccounts(accs); setRoles(r); })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    async function handleCreate(username, password, roleName) {
        const acc = await createAdminAccount(username, password, roleName);
        setAccounts(prev => [...prev, acc]);
        setSuccess(`Account "${username}" created. They will set up their authenticator on first login.`);
    }

    async function handleEditRole(id, roleName) {
        const updated = await editAdminAccount(id, { role: roleName });
        setAccounts(prev => prev.map(a => a.id === id ? { ...a, role: updated.role, level: updated.level } : a));
        setSuccess(`Role updated for "${updated.username}"`);
    }

    async function confirmDelete(acc) {
        setError(''); setSuccess('');
        try {
            await deleteAdminAccount(acc.id);
            setAccounts(prev => prev.filter(a => a.id !== acc.id));
            setSuccess(`Account "${acc.username}" deleted`);
        } catch (e) {
            setError(e.message);
        } finally {
            setDeleteTarget(null);
        }
    }

    async function confirmResetMfa(acc) {
        setError(''); setSuccess('');
        try {
            await resetAdminMfa(acc.id);
            setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, totp_enrolled: false } : a));
            setSuccess(`MFA reset for "${acc.username}" — they will re-enrol on next login`);
        } catch (e) {
            setError(e.message);
        } finally {
            setMfaResetTarget(null);
        }
    }

    return (
        <div>
            <h1 className="screen-title">Admin Accounts</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                These accounts are separate from Cashflow user accounts. Credentials here cannot be used on the Cashflow app. Level ≥ {MIN_LEVEL}.
            </p>
            {error && <div className="screen-error">{error}</div>}
            {success && <div className="screen-success">{success}</div>}
            <div style={{ marginBottom: 16 }}>
                <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New account</button>
            </div>
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
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
                            {accounts.map(acc => {
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
                                                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(acc)}>Delete</button>
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
                            {accounts.length === 0 && (
                                <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No admin accounts yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {showCreate && (
                <CreateAdminModal
                    roles={roles}
                    caller={caller}
                    onSave={handleCreate}
                    onClose={() => setShowCreate(false)}
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
            {deleteTarget && (
                <ConfirmDeleteModal
                    message={`Delete admin account "${deleteTarget.username}"? This cannot be undone.`}
                    onConfirm={() => confirmDelete(deleteTarget)}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}
            {mfaResetTarget && (
                <ConfirmDeleteModal
                    message={`Reset MFA for "${mfaResetTarget.username}"? They will be required to re-enrol their authenticator on next login.`}
                    onConfirm={() => confirmResetMfa(mfaResetTarget)}
                    onCancel={() => setMfaResetTarget(null)}
                />
            )}
        </div>
    );
}
