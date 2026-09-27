import { useEffect, useState, useRef, useCallback } from 'react';
import { getGeoLogs } from '../../api.js';

const OUTCOME_LABELS = {
    allowed:           'Allowed',
    country_changed:   'Country changed',
    blocked_allowlist: 'Blocked (allowlist)',
    blocked_travel:    'Blocked (travel)',
    api_error:         'API error',
};

const OUTCOME_COLORS = {
    allowed:           'var(--success, #2ecc71)',
    country_changed:   'var(--warning, #f39c12)',
    blocked_allowlist: 'var(--danger, #e74c3c)',
    blocked_travel:    'var(--danger, #e74c3c)',
    api_error:         'var(--text-muted)',
};

const TRIGGER_LABELS = {
    login:         'Login',
    heartbeat:     'Heartbeat',
    token_refresh: 'Token refresh',
    page_focus:    'Page focus',
};

// Dual-range date slider
function DateRangeSlider({ min, max, fromDay, toDay, onChange }) {
    const rangeRef = useRef(null);

    function clampFrom(v) {
        return Math.min(v, toDay - 1);
    }
    function clampTo(v) {
        return Math.max(v, fromDay + 1);
    }

    const pct = (v) => ((v - min) / (max - min)) * 100;

    return (
        <div style={{ position: 'relative', padding: '8px 0' }}>
            <div
                style={{
                    position: 'relative',
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--border-color, #dee2e6)',
                    margin: '6px 0',
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        left: `${pct(fromDay)}%`,
                        width: `${pct(toDay) - pct(fromDay)}%`,
                        height: '100%',
                        background: 'var(--primary, #007bff)',
                        borderRadius: 3,
                    }}
                />
            </div>
            {/* From thumb */}
            <input
                type="range"
                min={min}
                max={max}
                value={fromDay}
                onChange={(e) => onChange(clampFrom(Number(e.target.value)), toDay)}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    height: 22,
                    zIndex: fromDay > max - 5 ? 5 : 3,
                }}
            />
            {/* To thumb */}
            <input
                type="range"
                min={min}
                max={max}
                value={toDay}
                onChange={(e) => onChange(fromDay, clampTo(Number(e.target.value)))}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    height: 22,
                    zIndex: 4,
                }}
            />
        </div>
    );
}

function dayLabel(offsetFromNow) {
    if (offsetFromNow === 0) return 'Today';
    if (offsetFromNow === 1) return 'Yesterday';
    return `${offsetFromNow}d ago`;
}

export default function GeoLogsScreen({ caller }) {
    const [logs, setLogs]           = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [userId, setUserId]       = useState('');
    const [fromDay, setFromDay]     = useState(90);  // days ago (90 = 90 days ago)
    const [toDay, setToDay]         = useState(0);   // days ago (0 = today)
    const MAX_DAYS = 90;

    // Derive unique users from current results for dropdown
    const users = [...new Map(
        logs.map(r => [r.admin_user_id, { id: r.admin_user_id, username: r.username }])
    ).values()].sort((a, b) => a.username.localeCompare(b.username));

    const toIso = (daysAgo) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        if (daysAgo === 0) d.setHours(23, 59, 59, 999);
        else d.setHours(0, 0, 0, 0);
        return d.toISOString();
    };

    const load = useCallback(() => {
        setLoading(true); setError('');
        getGeoLogs({
            userId:  userId || '',
            from:    toIso(fromDay),
            to:      toIso(toDay),
            limit:   2000,
        })
            .then(d => setLogs(d.logs || []))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [userId, fromDay, toDay]);

    useEffect(() => { load(); }, []);

    const filtered = userId
        ? logs.filter(r => String(r.admin_user_id) === String(userId))
        : logs;

    return (
        <div>
            <h1 className="screen-title">Geo Logs</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
                ip-api.com lookup history for all admin sessions. Shows last 90 days.
            </p>

            {error && <div className="screen-error">{error}</div>}

            {/* Filters */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
                <div style={{ minWidth: 180 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                        Account
                    </label>
                    <select
                        className="admin-input"
                        value={userId}
                        onChange={e => setUserId(e.target.value)}
                        style={{ width: '100%' }}
                    >
                        <option value="">All visible accounts</option>
                        {users.map(u => (
                            <option key={u.id} value={u.id}>{u.username}</option>
                        ))}
                    </select>
                </div>

                <div style={{ flex: '1 1 280px', minWidth: 240 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                        <span>From: <strong>{dayLabel(fromDay)}</strong></span>
                        <span>To: <strong>{dayLabel(toDay)}</strong></span>
                    </div>
                    <DateRangeSlider
                        min={0}
                        max={MAX_DAYS}
                        fromDay={fromDay}
                        toDay={toDay}
                        onChange={(f, t) => { setFromDay(f); setToDay(t); }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                        <span>90d ago</span>
                        <span>Today</span>
                    </div>
                </div>

                <button className="btn btn-primary btn-sm" onClick={load} style={{ alignSelf: 'flex-end' }}>
                    Search
                </button>
            </div>

            {/* Stats bar */}
            {!loading && (
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span><strong>{filtered.length}</strong> rows</span>
                    {['blocked_travel', 'blocked_allowlist'].map(o => {
                        const n = filtered.filter(r => r.outcome === o).length;
                        return n > 0 ? (
                            <span key={o} style={{ color: OUTCOME_COLORS[o] }}>
                                {n} {OUTCOME_LABELS[o]}
                            </span>
                        ) : null;
                    })}
                </div>
            )}

            {/* Table */}
            {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : (
                <div
                    className="admin-table-wrap"
                    style={{ maxHeight: 600, overflowY: 'auto', overflowX: 'auto' }}
                >
                    <table style={{ minWidth: 780 }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2, var(--surface))', zIndex: 2 }}>
                            <tr>
                                <th style={{ whiteSpace: 'nowrap' }}>Time</th>
                                <th>Account</th>
                                <th>IP</th>
                                <th>Trigger</th>
                                <th>Country</th>
                                <th>Continent</th>
                                <th>Outcome</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(row => (
                                <tr key={row.id}>
                                    <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                        {new Date(row.created_at).toLocaleString()}
                                    </td>
                                    <td style={{ fontWeight: 600, fontSize: 13 }}>{row.username}</td>
                                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                        {row.ip_address || '—'}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                        {TRIGGER_LABELS[row.trigger] || row.trigger || '—'}
                                    </td>
                                    <td style={{ fontSize: 13, fontWeight: 600 }}>
                                        {row.country_code || '—'}
                                    </td>
                                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                        {row.continent_code || '—'}
                                    </td>
                                    <td>
                                        <span style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: OUTCOME_COLORS[row.outcome] || 'var(--text-muted)',
                                        }}>
                                            {OUTCOME_LABELS[row.outcome] || row.outcome || '—'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                                        No geo log entries found
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
