import { useEffect, useState } from 'react';
import { getUsers, unlockUser } from '../../api.js';

function lockStatus(user) {
    if (user.login_locked_until) {
        const until = new Date(user.login_locked_until);
        if (until.getFullYear() >= 9999) return 'permanent';
        if (until > new Date()) return 'timed';
    }
    if (user.login_locked) return 'locked';
    return 'ok';
}

function LockLabel({ user }) {
    const status = lockStatus(user);
    if (status === 'ok') {
        return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Not locked</span>;
    }
    if (status === 'permanent') {
        return <span style={{ color: 'var(--danger)', fontSize: 12 }}>Permanently locked</span>;
    }
    if (status === 'timed') {
        const until = new Date(user.login_locked_until);
        return <span style={{ color: 'var(--warning)', fontSize: 12 }}>Locked until {until.toLocaleString()}</span>;
    }
    return <span style={{ color: 'var(--warning)', fontSize: 12 }}>Locked</span>;
}

export default function UnlockScreen() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [search, setSearch] = useState('');
    const [unlocking, setUnlocking] = useState(null);

    useEffect(() => {
        getUsers()
            .then(setUsers)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    async function handleUnlock(user) {
        setError(''); setSuccess('');
        setUnlocking(user.id);
        try {
            await unlockUser(user.id);
            setUsers(prev => prev.map(u => u.id === user.id
                ? { ...u, login_locked: false, login_locked_until: null, failed_login_attempts: 0 }
                : u
            ));
            setSuccess(`Account unlocked for "${user.username}"`);
        } catch (e) {
            setError(e.message);
        } finally {
            setUnlocking(null);
        }
    }

    const filtered = users.filter(u =>
        u.username.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div>
            <h1 className="screen-title">Unlock Account</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 13 }}>
                Unlocking clears login lockout and email rate-limit counters. Limits still apply normally after unlock.
            </p>
            {error && <div className="screen-error">{error}</div>}
            {success && <div className="screen-success">{success}</div>}
            <div className="admin-search-row">
                <input
                    className="admin-input"
                    placeholder="Search by username…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
                <div className="admin-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Username</th>
                                <th>Role</th>
                                <th>Failed attempts</th>
                                <th>Lock status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(u => {
                                const locked = lockStatus(u) !== 'ok';
                                return (
                                    <tr key={u.id}>
                                        <td style={{ color: 'var(--text-muted)' }}>{u.id}</td>
                                        <td>{u.username}</td>
                                        <td>{u.role}</td>
                                        <td style={{ color: u.failed_login_attempts > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                                            {u.failed_login_attempts}
                                        </td>
                                        <td><LockLabel user={u} /></td>
                                        <td>
                                            {locked ? (
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    disabled={unlocking === u.id}
                                                    onClick={() => handleUnlock(u)}
                                                >
                                                    {unlocking === u.id ? 'Unlocking…' : 'Unlock'}
                                                </button>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>N/A</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
