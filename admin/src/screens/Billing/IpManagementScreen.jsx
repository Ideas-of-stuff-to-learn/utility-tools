import { useEffect, useState } from 'react';
import { getIpLog } from '../../api.js';

const ACTION_COLORS = {
    lock:   'var(--warning)',
    ban:    'var(--danger)',
    unlock: 'var(--success, #4caf50)',
    unban:  'var(--success, #4caf50)',
};

export default function IpManagementScreen() {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [ipSearch, setIpSearch] = useState('');
    const [appliedIp, setAppliedIp] = useState('');

    function load(ip = '') {
        setLoading(true); setError('');
        getIpLog({ ip })
            .then(d => setEntries(d.entries))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => { load(); }, []);

    function handleSearch(e) {
        e.preventDefault();
        setAppliedIp(ipSearch.trim());
        load(ipSearch.trim());
    }

    function handleClear() {
        setIpSearch(''); setAppliedIp('');
        load('');
    }

    return (
        <div>
            <h1 className="screen-title">IP Management</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 13 }}>
                Audit log of IP address lock, unlock, ban, and unban events.
            </p>
            {error && <div className="screen-error">{error}</div>}

            <form className="admin-search-row" onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
                <input
                    className="admin-input"
                    placeholder="Filter by IP address…"
                    value={ipSearch}
                    onChange={e => setIpSearch(e.target.value)}
                    style={{ maxWidth: 260 }}
                />
                <button className="btn btn-primary btn-sm" type="submit">Search</button>
                {appliedIp && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={handleClear}>
                        Clear
                    </button>
                )}
            </form>

            {loading ? (
                <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Loading…</p>
            ) : entries.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>No entries found.</p>
            ) : (
                <div className="admin-table-wrap" style={{ marginTop: 16 }}>
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>IP Address</th>
                                <th>Action</th>
                                <th>Reason</th>
                                <th>Performed by</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map(e => (
                                <tr key={e.id}>
                                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{e.id}</td>
                                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{e.ip_address}</td>
                                    <td>
                                        <span style={{
                                            color: ACTION_COLORS[e.action] || 'var(--text)',
                                            fontWeight: 600, fontSize: 12,
                                        }}>
                                            {e.action}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200, wordBreak: 'break-word' }}>
                                        {e.reason || '—'}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {e.performed_by_username
                                            ? `${e.performed_by_username} (${e.performed_by})`
                                            : e.performed_by ? `uid ${e.performed_by}` : '—'
                                        }
                                    </td>
                                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                        {e.performed_at ? new Date(e.performed_at).toLocaleString() : '—'}
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
