import { useEffect, useState } from 'react';
import { getRoles, getUsers, createUserAccount, deleteUserAccount } from '../../api.js';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal.jsx';

const MIN_LEVEL = parseInt(import.meta.env.VITE_ADMIN_ACCOUNT_MIN_LEVEL ?? '30', 10);

function CreateUserModal({ roles, caller, onSave, onClose }) {
    const [username, setUsername] = useState('');
    const [email, setEmail]       = useState('');
    const [password, setPassword] = useState('');
    const [roleName, setRoleName] = useState('');
    const [saving, setSaving]     = useState(false);
    const [error, setError]       = useState('');

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

export default function UserAccountsScreen({ caller = { role: 'user', level: 0 } }) {
    const [accounts, setAccounts] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showCreate, setShowCreate] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);

    useEffect(() => {
        Promise.all([getRoles(), getUsers()])
            .then(([r, users]) => {
                setRoles(r);
                setAccounts(users.filter(u => u.level > 0 && u.level < MIN_LEVEL));
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    async function handleCreate(username, email, password, roleName) {
        const user = await createUserAccount(username, email, password, roleName);
        setAccounts(prev => [...prev, user]);
        setSuccess(`Account "${username}" created.`);
    }

    async function confirmDelete(user) {
        setError(''); setSuccess('');
        try {
            await deleteUserAccount(user.id);
            setAccounts(prev => prev.filter(u => u.id !== user.id));
            setSuccess(`Account "${user.username}" deleted`);
        } catch (e) {
            setError(e.message);
        } finally {
            setDeleteTarget(null);
        }
    }

    return (
        <div>
            <h1 className="screen-title">User Accounts</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                Cashflow user accounts with an elevated role (level 1–{MIN_LEVEL - 1}). Default-level users (level 0) are visible in the Users screen.
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
                                <th>Email</th>
                                <th>Role</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map(user => {
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
                                                <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(user)}>Delete</button>
                                            ) : (
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not authorised</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {accounts.length === 0 && (
                                <tr><td colSpan={4} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>No elevated user accounts yet</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
            {showCreate && (
                <CreateUserModal
                    roles={roles}
                    caller={caller}
                    onSave={handleCreate}
                    onClose={() => setShowCreate(false)}
                />
            )}
            {deleteTarget && (
                <ConfirmDeleteModal
                    message={`Delete user account "${deleteTarget.username}"? All their transactions and data will be permanently removed.`}
                    onConfirm={() => confirmDelete(deleteTarget)}
                    onCancel={() => setDeleteTarget(null)}
                />
            )}
        </div>
    );
}
