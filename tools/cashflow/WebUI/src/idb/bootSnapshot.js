/**
 * idb/bootSnapshot.js
 *
 * Everything the dashboard needs to paint — transactions, categories,
 * upload stats and the server fingerprint they correspond to — stored as ONE
 * AES-GCM encrypted record. Boot cost is one IDB read + one decrypt +
 * one JSON.parse, instead of one decrypt per transaction.
 *
 * The ciphertext read needs no key, so main.jsx starts it before React
 * renders, in parallel with /auth/me. The DEK itself is never persisted.
 */

import { encryptBytes, decryptBytes } from './crypto.js';
import { readRecord, replaceStoreWithRecord, remove } from './store.js';

const STORE = 'transactions';
const KEY = '__snapshot__';
const SNAPSHOT_VERSION = 2;
// Pre-snapshot per-row caches; cleared when the first snapshot is written.
const LEGACY_STORES = ['categories', 'upload_stats', '_meta'];
const LEGACY_PREF_KEYS = ['chart_summary', 'chart_render_cache'];

// The DB is named per user, so reading before /auth/me needs the last
// user id. It is already visible in the IDB database name; this adds no
// new exposure. Checked against the real id before anything is decrypted.
const UID_KEY = 'cashflow_idb_uid';

let _prefetch = null;
let _legacyCleaned = false;

function readLastUserId() { try { return localStorage.getItem(UID_KEY); } catch { return null; } }
function rememberUserId(userId) { try { localStorage.setItem(UID_KEY, String(userId)); } catch {} }

export function prefetchBootSnapshot() {
    const uid = readLastUserId();
    if (!uid) return;
    _prefetch = { userId: uid, promise: readRecord(uid, STORE, KEY) };
}

export async function loadBootSnapshot(userId, cryptoKey) {
    const uid = String(userId);
    const recordPromise = _prefetch?.userId === uid ? _prefetch.promise : readRecord(uid, STORE, KEY);
    _prefetch = null;
    rememberUserId(uid);

    const record = await recordPromise;
    if (!record?.iv || !record?.data) return null;
    try {
        const snap = JSON.parse(await decryptBytes(cryptoKey, record.iv, record.data));
        return snap?.v === SNAPSHOT_VERSION ? snap : null;
    } catch {
        return null;
    }
}

export async function saveBootSnapshot(userId, cryptoKey, snapshot) {
    const uid = String(userId);
    const { iv, data } = await encryptBytes(cryptoKey, JSON.stringify({ ...snapshot, v: SNAPSHOT_VERSION }));
    const ok = await replaceStoreWithRecord(uid, STORE, KEY, { iv, data }, _legacyCleaned ? [] : LEGACY_STORES);
    if (ok && !_legacyCleaned) {
        _legacyCleaned = true;
        for (const k of LEGACY_PREF_KEYS) remove(uid, 'preferences', k);
    }
    return ok;
}
