import { useEffect, useState } from 'react';
import { getRoles, getPermissions, createRole, updateRole, deleteRole, cancelRoleDeletion } from '../../api.js';
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal.jsx';
import { computeRoleLevel } from '../../utils/permissionWeights.js';

function RoleModal({ role, allPermissions, allRoles, caller, onSave, onClose }) {
    const [name, setName] = useState(role?.name || '');
    const [selected, setSelected] = useState(new Set(role?.permissions || []));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [manualLevel, setManualLevel] = useState(role?.level ?? '');

    const overrideMin = parseInt(import.meta.env.VITE_ADMIN_LEVEL_OVERRIDE_MIN ?? '80', 10);
    const canOverride = caller.role === 'owner' || caller.level >= overrideMin;

    const computedLevel = computeRoleLevel([...selected]);
    // tooHigh always based on formula — override only fine-tunes within the allowed range
    const tooHigh = computedLevel >= caller.level;
    const effectiveLevel = canOverride && manualLevel !== '' ? parseInt(manualLevel, 10) : computedLevel;

    const grantablePerms = new Set(
        allPermissions
            .filter(p => {
                const rolesWithPerm = allRoles.filter(r => (r.permissions || []).includes(p.key));
                if (rolesWithPerm.length === 0) return true;
                return rolesWithPerm.some(r => r.level < caller.level);
            })
            .map(p => p.key)
    );

    function togglePerm(key) {
        if (!grantablePerms.has(key)) return;
        setSelected(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    }

    async function handleSave() {
        if (tooHigh) return;
        setSaving(true); setError('');
        try {
            await onSave({ name, level: effectiveLevel, permissions: [...selected] });
            onClose();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    const sortedRoles = [...allRoles].sort((a, b) => b.level - a.level);

    return (
        <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 560 }}>
                <div className="modal-title">{role ? 'Edit Role' : 'Create Role'}</div>
                {error && <div className="screen-error">{error}</div>}
                <div className="form-row">
                    <label className="form-label">Name</label>
                    <input className="admin-input" value={name} onChange={e => setName(e.target.value)} disabled={!!role} />
                </div>
                <div className="form-row">
                    <label className="form-label">Level</label>
                    {canOverride ? (
                        <>
                            <input
                                className="admin-input"
                                type="number"
                                value={manualLevel}
                                placeholder={computedLevel}
                                min={1}
                                max={caller.level - 1}
                                onChange={e => setManualLevel(e.target.value)}
                                style={{ maxWidth: 120 }}
                            />
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                Formula suggests <strong>{computedLevel}</strong> — leave blank to use it (max {caller.level - 1})
                            </div>
                        </>
                    ) : (
                        <>
                            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                                {computedLevel}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                Auto-calculated from selected permissions
                            </div>
                        </>
                    )}
                    {sortedRoles.length > 0 && (
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.8 }}>
                            <strong style={{ color: 'var(--text)' }}>Existing levels:</strong>{' '}
                            {sortedRoles.map(r => `${r.name} = ${r.level}`).join(' · ')}
                        </div>
                    )}
                </div>
                <div className="form-row">
                    <label className="form-label">Permissions</label>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(allPermissions.filter(p => grantablePerms.has(p.key)).map(p => p.key)))}>Select all</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Deselect all</button>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {allPermissions.map(p => {
                            const canGrant = grantablePerms.has(p.key);
                            return (
                                <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: canGrant ? 'pointer' : 'not-allowed', fontSize: 13, color: canGrant ? 'var(--text)' : 'var(--text-muted)', opacity: canGrant ? 1 : 0.5 }}>
                                    <input type="checkbox" checked={selected.has(p.key)} onChange={() => togglePerm(p.key)} disabled={!canGrant} style={{ marginTop: 2 }} />
                                    <span>
                                        <span>{p.key}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block' }}>{p.description}{!canGrant ? ' — requires higher level' : ''}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
                    {tooHigh ? (
                        <div style={{
                            background: 'var(--danger, #ef4444)',
                            color: '#fff',
                            borderRadius: 6,
                            padding: '8px 16px',
                            fontSize: 13,
                            fontWeight: 600,
                            userSelect: 'none',
                            cursor: 'default',
                        }}>
                            Role power ≥ your level — unauthorised
                        </div>
                    ) : (
                        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function RolesScreen({ caller = { role: 'user', level: 0 } }) {
    const [roles, setRoles] = useState([]);
    const [allPermissions, setAllPermissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [modal, setModal] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);

    useEffect(() => {
        Promise.all([getRoles(), getPermissions()])
            .then(([r, p]) => { setRoles(r); setAllPermissions(p); })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    async function handleSave({ name, level, permissions }) {
        if (modal === 'create') {
            const role = await createRole(name, level, permissions);
            setRoles(prev => [...prev, role]);
            setSuccess(`Role "${name}" created`);
        } else {
            const updated = await updateRole(modal.id, { level, permissions });
            setRoles(prev => prev.map(r => r.id === modal.id ? updated : r));
            setSuccess(`Role "${modal.name}" updated`);
        }
    }

    async function confirmDelete(role) {
        setError(''); setSuccess('');
        const result = await deleteRole(role.id);
        setRoles(prev => prev.map(r =>
            r.id === role.id ? { ...r, pending_deletion_at: result.pending_deletion_at } : r
        ));
    }

    async function handleCancelDelete(role) {
        setError(''); setSuccess('');
        try {
            await cancelRoleDeletion(role.id);
            setRoles(prev => prev.map(r =>
                r.id === role.id ? { ...r, pending_deletion_at: null } : r
            ));
            setSuccess(`Deletion cancelled for "${role.name}"`);
        } catch (e) {
            setError(e.message);
        }
    }

    return (
        <div>
            <h1 className="screen-title">Roles &amp; Permissions</h1>
            {error && <div className="screen-error">{error}</div>}
            {success && <div className="screen-success">{success}</div>}
            <div style={{ marginBottom: 16 }}>
                <button className="btn btn-primary" onClick={() => setModal('create')}>+ New Role</button>
            </div>
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
                <div className="admin-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Level</th>
                                <th>Permissions</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[...roles].sort((a, b) => b.level - a.level).map(r => {
                                const isPending = !!r.pending_deletion_at;
                                return (
                                <tr key={r.id} style={isPending ? { opacity: 0.6 } : {}}>
                                    <td style={{ fontWeight: 600 }}>
                                        {r.name}
                                        {isPending && (
                                            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--danger)', fontWeight: 400 }}>
                                                ⏳ pending deletion
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.level}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
                                            {r.level >= 100 ? '(owner tier)' : r.level >= 50 ? '(admin tier)' : '(user tier)'}
                                        </span>
                                    </td>
                                    <td style={{ maxWidth: 400, fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-word' }}>
                                        {(r.permissions || []).join(', ') || '—'}
                                    </td>
                                    <td>
                                        <div className="row-actions">
                                            {r.level >= caller.level ? (
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Not authorised to edit</span>
                                            ) : isPending ? (
                                                <button className="btn btn-primary btn-sm" onClick={() => handleCancelDelete(r)}>Cancel deletion</button>
                                            ) : (
                                                <>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => setModal(r)}>Edit</button>
                                                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(r)}>Delete</button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            {deleteTarget && (
                <ConfirmDeleteModal
                    title={`Delete role "${deleteTarget.name}"`}
                    description={`This will permanently remove the "${deleteTarget.name}" role. Users assigned to it will lose their role.`}
                    onConfirm={() => confirmDelete(deleteTarget)}
                    onClose={() => setDeleteTarget(null)}
                />
            )}
            {modal && (
                <RoleModal
                    role={modal === 'create' ? null : modal}
                    allPermissions={allPermissions}
                    allRoles={roles}
                    caller={caller}
                    onSave={handleSave}
                    onClose={() => setModal(null)}
                />
            )}
        </div>
    );
}
