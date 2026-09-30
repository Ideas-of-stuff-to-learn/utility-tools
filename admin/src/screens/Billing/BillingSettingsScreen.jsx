import { useEffect, useState } from 'react';
import { getBillingSettings, updateBillingSettings } from '../../api.js';

const FIELD_ORDER = [
    'trial_length_days',
    'upload_cap_base',
    'upload_files_per_action_base',
    'first_n_users_exempt',
    'trial_warning_day',
    'stripe_price_id_pro_monthly',
    'stripe_price_id_pro_yearly',
];

export default function BillingSettingsScreen() {
    const [settings, setSettings] = useState([]);
    const [edits, setEdits] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        getBillingSettings()
            .then(d => {
                const sorted = [...d.settings].sort(
                    (a, b) => FIELD_ORDER.indexOf(a.key) - FIELD_ORDER.indexOf(b.key)
                );
                setSettings(sorted);
                const initial = {};
                sorted.forEach(s => { initial[s.key] = s.value; });
                setEdits(initial);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    const dirty = settings.some(s => edits[s.key] !== s.value);

    async function handleSave() {
        setError(''); setSuccess('');
        const updates = {};
        settings.forEach(s => {
            if (edits[s.key] !== s.value) updates[s.key] = edits[s.key];
        });
        if (!Object.keys(updates).length) return;

        setSaving(true);
        try {
            await updateBillingSettings(updates);
            setSettings(prev => prev.map(s => ({ ...s, value: updates[s.key] ?? s.value })));
            setSuccess('Settings saved.');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    function handleReset() {
        const initial = {};
        settings.forEach(s => { initial[s.key] = s.value; });
        setEdits(initial);
        setError(''); setSuccess('');
    }

    return (
        <div>
            <h1 className="screen-title">Billing Settings</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 13 }}>
                Runtime configuration for the billing and trial system. Changes take effect immediately.
            </p>
            {error   && <div className="screen-error">{error}</div>}
            {success && <div className="screen-success">{success}</div>}

            {loading ? (
                <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : (
                <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
                        {settings.map(s => (
                            <div key={s.key} className="form-row">
                                <label className="form-label" style={{ marginBottom: 4 }}>
                                    {s.key}
                                    {s.description && (
                                        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>
                                            — {s.description}
                                        </span>
                                    )}
                                </label>
                                <input
                                    className="admin-input"
                                    value={edits[s.key] ?? ''}
                                    onChange={e => setEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                                    placeholder={s.key.startsWith('stripe_price_id') ? 'price_...' : ''}
                                />
                                {s.updated_at && (
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                                        Last updated {new Date(s.updated_at).toLocaleString()}
                                        {s.updated_by ? ` by uid ${s.updated_by}` : ''}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                        <button
                            className="btn btn-primary"
                            onClick={handleSave}
                            disabled={saving || !dirty}
                        >
                            {saving ? 'Saving…' : 'Save changes'}
                        </button>
                        {dirty && (
                            <button className="btn btn-ghost" onClick={handleReset} disabled={saving}>
                                Reset
                            </button>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
