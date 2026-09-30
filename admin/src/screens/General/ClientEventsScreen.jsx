import { useEffect, useState } from 'react';
import { getClientEvents } from '../../api.js';

const KIND_LABELS = {
    network_error: 'Network error',
    timeout:       'Timeout',
    http_error:    'Server error',
    slow_response: 'Slow response',
    boot_fallback: 'Boot fallback',
    idb_timeout:   'Local cache stall',
    queue_dropped: 'Save dropped',
};

const KIND_COLORS = {
    network_error: 'var(--danger, #e74c3c)',
    timeout:       'var(--danger, #e74c3c)',
    http_error:    'var(--danger, #e74c3c)',
    queue_dropped: 'var(--danger, #e74c3c)',
    slow_response: 'var(--warning, #f39c12)',
    boot_fallback: 'var(--warning, #f39c12)',
    idb_timeout:   'var(--warning, #f39c12)',
};

const WINDOWS = [
    { hours: 1,   label: 'Last hour' },
    { hours: 24,  label: 'Last 24 hours' },
    { hours: 168, label: 'Last 7 days' },
    { hours: 720, label: 'Last 30 days' },
];

const PAGE_SIZE = 200;

function formatDuration(ms) {
    if (ms === null || ms === undefined) return '—';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

// Read-only by design: this screen only ever calls a GET endpoint, and the
// backend has no write route for it.
export default function ClientEventsScreen() {
    const [events, setEvents]   = useState([]);
    const [summary, setSummary] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [hours, setHours]     = useState(168);
    const [kind, setKind]       = useState('');
    const [notConfigured, setNotConfigured] = useState(false);
    const [hasMore, setHasMore] = useState(false);

    function load({ append = false, nextKind = kind, nextHours = hours } = {}) {
        setLoading(true); setError('');
        const offset = append ? events.length : 0;
        getClientEvents({ hours: nextHours, kind: nextKind, limit: PAGE_SIZE, offset })
            .then(d => {
                setNotConfigured(!!d.not_configured);
                setSummary(d.summary || {});
                setEvents(prev => (append ? [...prev, ...d.events] : d.events));
                setHasMore((d.events || []).length === PAGE_SIZE);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => { load(); }, []);

    const total = Object.values(summary).reduce((a, b) => a + b, 0);

    return (
        <div>
            <h1 className="screen-title">Failed Network Calls</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                Failures reported by the web app: calls that errored or timed out, slow responses
                (cold starts), and boots that fell back from the local cache to the network.
                Read-only. Entries are kept for 30 days.
            </p>

            {error && <div className="screen-error">{error}</div>}
            {notConfigured && (
                <div className="screen-error">
                    The log table doesn't exist yet. Run <code>migrations/add_client_events.sql</code> in the
                    Supabase SQL editor, then refresh.
                </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, alignItems: 'flex-end' }}>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Period</label>
                    <select
                        className="admin-input"
                        value={hours}
                        onChange={e => { const h = Number(e.target.value); setHours(h); load({ nextHours: h }); }}
                    >
                        {WINDOWS.map(w => <option key={w.hours} value={w.hours}>{w.label}</option>)}
                    </select>
                </div>
                <div>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Type</label>
                    <select
                        className="admin-input"
                        value={kind}
                        onChange={e => { setKind(e.target.value); load({ nextKind: e.target.value }); }}
                    >
                        <option value="">All types</option>
                        {Object.entries(KIND_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => load()}>Refresh</button>
            </div>

            {!notConfigured && (
                <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span><strong>{total}</strong> in period</span>
                    {Object.entries(summary).map(([k, n]) => (
                        <span key={k} style={{ color: KIND_COLORS[k] }}>{n} {KIND_LABELS[k] || k}</span>
                    ))}
                </div>
            )}

            <div className="admin-table-wrap" style={{ maxHeight: 640, overflowY: 'auto', overflowX: 'auto' }}>
                <table style={{ minWidth: 900 }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2, var(--surface))', zIndex: 2 }}>
                        <tr>
                            <th style={{ whiteSpace: 'nowrap' }}>Time</th>
                            <th>User</th>
                            <th>Type</th>
                            <th>Call</th>
                            <th>Status</th>
                            <th>Took</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.map(ev => (
                            <tr key={ev.id}>
                                <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {new Date(ev.at).toLocaleString()}
                                </td>
                                <td style={{ fontWeight: 600, fontSize: 13 }}>{ev.username || '—'}</td>
                                <td>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: KIND_COLORS[ev.kind] || 'var(--text-muted)' }}>
                                        {KIND_LABELS[ev.kind] || ev.kind}
                                    </span>
                                </td>
                                <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                                    {ev.path ? `${ev.method ? ev.method + ' ' : ''}${ev.path}` : '—'}
                                </td>
                                <td style={{ fontSize: 12 }}>{ev.status || '—'}</td>
                                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDuration(ev.duration_ms)}</td>
                                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    {ev.message || '—'}
                                    {ev.page && <div style={{ fontSize: 11 }}>on {ev.page}</div>}
                                </td>
                            </tr>
                        ))}
                        {!loading && events.length === 0 && (
                            <tr>
                                <td colSpan={7} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                                    No failures reported in this period
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {loading && <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>Loading…</p>}
            {!loading && hasMore && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => load({ append: true })}>
                    Load more
                </button>
            )}
        </div>
    );
}
