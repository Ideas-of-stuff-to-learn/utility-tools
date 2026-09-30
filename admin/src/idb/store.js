/**
 * idb/store.js — encrypted IndexedDB for cashflow-admin-db-{adminUserId}.
 *
 * Lighter than the WebUI store — no transaction/category/upload caches.
 * Stores: preferences, write_queue, _meta, pending_ops.
 * All reads/writes encrypted with the admin user's DEK (CryptoKey).
 * Operations silently return null/undefined if IDB is unavailable.
 *
 * Every open and every operation is time-bounded. Stale/closed connections
 * are evicted so a locked DB never hangs the page.
 */

import { encrypt, decrypt } from './crypto.js';

const DB_VERSION    = 2;
const STORES        = ['preferences', 'write_queue', '_meta', 'pending_ops'];
const OPEN_TIMEOUT_MS = 5000;
const OP_TIMEOUT_MS   = 4000;

const _dbCache = new Map();

function _withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`IDB timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function _openDB(dbName) {
  if (_dbCache.has(dbName)) return _dbCache.get(dbName);

  const promise = _withTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const storeName of STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Evict when another tab upgrades the schema or the browser closes the DB.
      db.onversionchange = () => { db.close(); _dbCache.delete(dbName); };
      db.onclose        = () => _dbCache.delete(dbName);
      resolve(db);
    };
    req.onerror  = () => reject(req.error);
    req.onblocked = () => reject(new Error('IDB open blocked'));
  }), OPEN_TIMEOUT_MS).catch(err => {
    _dbCache.delete(dbName); // never cache a failed open
    throw err;
  });

  _dbCache.set(dbName, promise);
  return promise;
}

function _dbName(adminUserId) {
  return `cashflow-admin-db-${adminUserId}`;
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

export async function get(adminUserId, storeName, key, cryptoKey) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    return await _withTimeout(new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = async () => {
        if (req.result == null) { resolve(null); return; }
        try {
          const plain = await decrypt(cryptoKey, req.result);
          resolve(JSON.parse(plain));
        } catch { resolve(null); }
      };
      req.onerror = () => reject(req.error);
    }), OP_TIMEOUT_MS);
  } catch { return null; }
}

export async function put(adminUserId, storeName, key, value, cryptoKey) {
  try {
    const db   = await _openDB(_dbName(adminUserId));
    const blob = await encrypt(cryptoKey, JSON.stringify(value));
    await _withTimeout(new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    }), OP_TIMEOUT_MS);
  } catch { /* silently skip */ }
}

export async function remove(adminUserId, storeName, key) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    await _withTimeout(new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    }), OP_TIMEOUT_MS);
  } catch { /* silently skip */ }
}

export async function getAll(adminUserId, storeName, cryptoKey) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    const rawEntries = await _withTimeout(new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAllKeys();
      req.onsuccess = () => {
        const keys = req.result || [];
        const valReq = tx.objectStore(storeName).getAll();
        valReq.onsuccess = () => resolve(keys.map((k, i) => ({ key: k, raw: valReq.result[i] })));
        valReq.onerror   = () => reject(valReq.error);
      };
      req.onerror = () => reject(req.error);
    }), OP_TIMEOUT_MS);
    const items = await Promise.all(
      rawEntries.map(async ({ key, raw }) => {
        try { return { key, value: JSON.parse(await decrypt(cryptoKey, raw)) }; } catch { return null; }
      })
    );
    return items.filter(Boolean);
  } catch { return []; }
}

export async function clearStore(adminUserId, storeName) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    await _withTimeout(new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    }), OP_TIMEOUT_MS);
  } catch { /* silently skip */ }
}

// ── Meta / staleness ──────────────────────────────────────────────────────────

export async function getMeta(adminUserId, storeName, cryptoKey) {
  return get(adminUserId, '_meta', storeName, cryptoKey);
}

export async function setMeta(adminUserId, storeName, meta, cryptoKey) {
  return put(adminUserId, '_meta', storeName, meta, cryptoKey);
}

export function isStale(meta, { maxAgeMs, serverVersion } = {}) {
  if (!meta) return true;
  if (maxAgeMs != null && Date.now() - (meta.cached_at || 0) > maxAgeMs) return true;
  if (serverVersion != null && meta.version !== serverVersion) return true;
  return false;
}
