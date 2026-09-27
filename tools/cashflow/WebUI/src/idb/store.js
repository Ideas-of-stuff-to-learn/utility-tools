/**
 * idb/store.js
 *
 * Low-level encrypted IndexedDB operations for cashflow-db-{userId}.
 *
 * All reads/writes are encrypted with the user's DEK (CryptoKey).
 * Every method is wrapped in try/catch — if IDB is unavailable (private
 * browsing, storage quota, browser quirk) operations silently return null/
 * undefined so the app falls back to server-only mode without crashing.
 *
 * DB name is per-user so multiple accounts on the same browser are fully
 * isolated — each has its own encrypted DB requiring its own DEK.
 */

import { encrypt, decrypt } from './crypto.js';

const DB_VERSION = 1;
const STORES = ['preferences', 'transactions', 'categories', 'upload_stats', 'write_queue', '_meta'];

// Singleton open DB promise per DB name (keyed by dbName string)
const _dbCache = new Map();

function _openDB(dbName) {
  if (_dbCache.has(dbName)) return _dbCache.get(dbName);

  const promise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const storeName of STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          const opts = storeName === 'write_queue'
            ? { keyPath: 'qid', autoIncrement: true }
            : { keyPath: 'key' };
          db.createObjectStore(storeName, opts);
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  _dbCache.set(dbName, promise);
  return promise;
}

function _dbName(userId) {
  return `cashflow-db-${userId}`;
}

// ── Core CRUD ──────────────────────────────────────────────────────────────

export async function get(userId, storeName, key, cryptoKey) {
  try {
    const db = await _openDB(_dbName(userId));
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result?.value ?? null);
      req.onerror = () => reject(req.error);
    });
    if (value === null) return null;
    const plaintext = await decrypt(cryptoKey, value);
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

export async function put(userId, storeName, key, value, cryptoKey) {
  try {
    const db = await _openDB(_dbName(userId));
    const ciphertext = await encrypt(cryptoKey, JSON.stringify(value));
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put({ key, value: ciphertext });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Silently ignore — app falls back to server-only
  }
}

export async function getAll(userId, storeName, cryptoKey) {
  try {
    const db = await _openDB(_dbName(userId));
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    const results = [];
    for (const row of rows) {
      try {
        const plaintext = await decrypt(cryptoKey, row.value);
        results.push({ key: row.key, data: JSON.parse(plaintext) });
      } catch {
        // Skip undecryptable rows (wrong key, corruption)
      }
    }
    return results;
  } catch {
    return [];
  }
}

export async function remove(userId, storeName, key) {
  try {
    const db = await _openDB(_dbName(userId));
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Silently ignore
  }
}

export async function clearStore(userId, storeName) {
  try {
    const db = await _openDB(_dbName(userId));
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Silently ignore
  }
}

export async function clearAll(userId) {
  const dbName = _dbName(userId);
  _dbCache.delete(dbName);
  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve(); // proceed even if blocked
    });
  } catch {
    // Silently ignore
  }
}

// ── Metadata (staleness tracking) ─────────────────────────────────────────

export async function getMeta(userId, storeName, cryptoKey) {
  return get(userId, '_meta', storeName, cryptoKey);
}

export async function setMeta(userId, storeName, meta, cryptoKey) {
  return put(userId, '_meta', storeName, meta, cryptoKey);
}

/**
 * Returns true if the cached store should be re-fetched from the server.
 * @param {object|null} meta - result of getMeta()
 * @param {{ maxAgeMs?: number, serverVersion?: number }} opts
 */
export function isStale(meta, { maxAgeMs, serverVersion } = {}) {
  if (!meta) return true;
  if (maxAgeMs !== undefined && Date.now() - meta.cached_at > maxAgeMs) return true;
  if (serverVersion !== undefined && meta.version !== serverVersion) return true;
  return false;
}
