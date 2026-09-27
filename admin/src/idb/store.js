/**
 * idb/store.js — encrypted IndexedDB for cashflow-admin-db-{adminUserId}.
 *
 * Lighter than the WebUI store — no transaction/category/upload caches.
 * Stores: preferences, write_queue, _meta.
 * All reads/writes encrypted with the admin user's DEK (CryptoKey).
 * Operations silently return null/undefined if IDB is unavailable.
 */

import { encrypt, decrypt } from './crypto.js';

const DB_VERSION = 1;
const STORES = ['preferences', 'write_queue', '_meta'];

const _dbCache = new Map();

function _openDB(dbName) {
  if (_dbCache.has(dbName)) return _dbCache.get(dbName);

  const promise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const storeName of STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
    req.onblocked  = () => reject(new Error('IDB open blocked'));
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
    return new Promise((resolve, reject) => {
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
    });
  } catch { return null; }
}

export async function put(adminUserId, storeName, key, value, cryptoKey) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    const blob = await encrypt(cryptoKey, JSON.stringify(value));
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch { /* silently skip */ }
}

export async function remove(adminUserId, storeName, key) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch { /* silently skip */ }
}

export async function getAll(adminUserId, storeName, cryptoKey) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = async () => {
        try {
          const items = await Promise.all(
            (req.result || []).map(async (blob) => {
              try { return JSON.parse(await decrypt(cryptoKey, blob)); } catch { return null; }
            })
          );
          resolve(items.filter(Boolean));
        } catch { resolve([]); }
      };
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

export async function clearStore(adminUserId, storeName) {
  try {
    const db = await _openDB(_dbName(adminUserId));
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
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
