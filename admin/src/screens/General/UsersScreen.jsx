import { useEffect, useState } from 'react';
import { getUsers, getRoles, assignRole } from '../../api.js';

export default function UsersScreen({ caller }) {
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [search, setSearch] = useState('');
    const [assigning, setAssigning] = useState(null); // { userId, roleName }

    useEffect(() => {
        Promise.all([getUsers(), getRoles()])
            .then(([u, r]) => { setUsers(u); setRoles(r); })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    async function handleAssignRole(userId, roleName) {
        setError(''); setSuccess('');
        try {
            const updated = await assignRole(userId, roleName);
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: updated.role } : u));
            setSuccess(`Role updated for user ${userId}`);
        } catch (e) {
            setError(e.message);
        } finally {
            setAssigning(null);
        }
    }

    const filtered = users.filter(u =>
        u.username.toLowerCase().includes(search.toLowerCase())
    );

    const assignableRoles = roles.filter(r => r.level < (caller?.level ?? 0));

    function roleBadgeClass(role) {
        if (role === 'owner') return 'badge badge-owner';
        if (role === 'admin') return 'badge badge-admin';
        return 'badge badge-user';
    }

    return (
        <div>
            <h1 className="screen-title">Users</h1>
            {error && <div className="screen-error">{error}</div>}
            {success && <div className="screen-success">{success}</div>}
            <div className="admin-search-row">
                <input
                    className="admin-input"
                    placeholder="Search by username…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
            </div>
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
                <div className="admin-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Username</th>
                                <th>Role</th>
                                <th>Level</th>
                                <th>Email</th>
                                <th>Change Role</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(u => (
                                <tr key={u.id}>
                                    <td style={{ color: 'var(--text-muted)' }}>{u.id}</td>
                                    <td>{u.username}</td>
                                    <td><span className={roleBadgeClass(u.role)}>{u.role}</span></td>
                                    <td>
                                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{u.level}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
                                            {u.level >= 100 ? '(owner tier)' : u.level >= 50 ? '(admin tier)' : '(user tier)'}
                                        </span>
                                    </td>
                                    <td style={{ color: 'var(--text-muted)' }}>{u.email || '—'}</td>
                                    <td>
                                        {u.level >= (caller?.level ?? 0) ? (
                                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not authorised to edit</span>
                                        ) : assigning?.userId === u.id ? (
                                            <div className="row-actions">
                                                <select
                                                    className="admin-select"
                                                    defaultValue=""
                                                    onChange={e => {
                                                        if (e.target.value) handleAssignRole(u.id, e.target.value);
                                                    }}
                                                >
                                                    <option value="" disabled>Select role…</option>
                                                    {assignableRoles.map(r => (
                                                        <option key={r.id} value={r.name}>{r.name}</option>
                                                    ))}
                                                </select>
                                                <button className="btn btn-ghost btn-sm" onClick={() => setAssigning(null)}>Cancel</button>
                                            </div>
                                        ) : (
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => setAssigning({ userId: u.id })}
                                            >Change</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
