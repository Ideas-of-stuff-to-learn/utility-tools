import { useEffect, useState } from 'react';
import { getAuditLog } from '../../api.js';

const ACTION_LABELS = {
    'roles.create':           'Created role',
    'roles.edit':             'Edited role',
    'roles.delete':           'Deleted role',
    'users.assign_role':      'Assigned role',
    'users.impersonate':      'Impersonated user',
    'admin.account.create':   'Created admin account',
    'admin.account.delete':   'Deleted admin account',
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

function DetailCell({ detail }) {
    if (!detail) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    const entries = Object.entries(detail).filter(([, v]) => v !== null && v !== undefined);
    if (!entries.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {entries.map(([k, v]) => (
                <span key={k} style={{ marginRight: 8 }}>
                    <strong>{k}:</strong> {Array.isArray(v) ? v.join(', ') || '—' : String(v)}
                </span>
            ))}
        </span>
    );
}

export default function AuditLogScreen() {
    const [log, setLog]         = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [actor, setActor]     = useState('');
    const [action, setAction]   = useState('');

    function load() {
        setLoading(true); setError('');
        getAuditLog({ actor, action })
            .then(setLog)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => { load(); }, []);

    return (
        <div>
            <h1 className="screen-title">Audit Log</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                All significant admin actions across all accounts.
            </p>
            {error && <div className="screen-error">{error}</div>}
            <div className="admin-search-row" style={{ marginBottom: 16 }}>
                <input
                    className="admin-input"
                    placeholder="Filter by actor…"
                    value={actor}
                    onChange={e => setActor(e.target.value)}
                    style={{ maxWidth: 200 }}
                />
                <select
                    className="admin-input"
                    value={action}
                    onChange={e => setAction(e.target.value)}
                    style={{ maxWidth: 220 }}
                >
                    <option value="">All actions</option>
                    {ALL_ACTIONS.map(a => (
                        <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                    ))}
                </select>
                <button className="btn btn-primary btn-sm" onClick={load}>Search</button>
            </div>
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
                <div className="admin-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Actor</th>
                                <th>Action</th>
                                <th>Target</th>
                                <th>Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            {log.map(row => (
                                <tr key={row.id}>
                                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                        {new Date(row.created_at).toLocaleString()}
                                    </td>
                                    <td style={{ fontWeight: 600 }}>{row.actor}</td>
                                    <td>
                                        <span style={{ fontSize: 12 }}>
                                            {ACTION_LABELS[row.action] || row.action}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        {row.target_type && row.target_id
                                            ? `${row.target_type} #${row.target_id}`
                                            : '—'}
                                    </td>
                                    <td><DetailCell detail={row.detail} /></td>
                                </tr>
                            ))}
                            {log.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                                        No events found
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
