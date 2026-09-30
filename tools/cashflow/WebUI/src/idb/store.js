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
 * Nothing here may hang. IndexedDB can stall (another tab or a dead renderer
 * holding a lock on the database, a pending version change), and a promise
 * that never settles would freeze whatever awaits it. Opening the database
 * and every transaction is therefore time-bounded, and a failed or dropped
 * connection is evicted from the cache so the next call retries.
 *
 * DB name is per-user so multiple accounts on the same browser are fully
 * isolated — each has its own encrypted DB requiring its own DEK.
 */

import { encrypt, decrypt } from './crypto.js';

const DB_VERSION = 1;
const STORES = ['preferences', 'transactions', 'categories', 'upload_stats', 'write_queue', '_meta'];

const OPEN_TIMEOUT_MS = 5000;
const OP_TIMEOUT_MS = 4000;

// Singleton open DB promise per DB name (keyed by dbName string)
const _dbCache = new Map();

function _withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`IndexedDB ${what} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function _openDB(dbName) {
  if (_dbCache.has(dbName)) return _dbCache.get(dbName);

  const promise = _withTimeout(new Promise((resolve, reject) => {
    let timedOut = false;
    const evict = () => { if (_dbCache.get(dbName) === promise) _dbCache.delete(dbName); };
    setTimeout(() => { timedOut = true; }, OPEN_TIMEOUT_MS);

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

    req.onsuccess = () => {
      const db = req.result;
      // Let a future schema upgrade or a delete proceed instead of being
      // blocked forever by this connection, and forget a connection the
      // browser closed under us.
      db.onversionchange = () => { db.close(); evict(); };
      db.onclose = evict;
      if (timedOut) { db.close(); return; }
      resolve(db);
    };
    req.onerror = () => { evict(); reject(req.error); };
  }), OPEN_TIMEOUT_MS, 'open');

  // A failed or timed-out open must not be cached: the next call retries.
  promise.catch(() => { if (_dbCache.get(dbName) === promise) _dbCache.delete(dbName); });
  _dbCache.set(dbName, promise);
  return promise;
}

function _dbName(userId) {
  return `cashflow-db-${userId}`;
}

// Runs one transaction and settles when it completes (or fails, aborts or
// times out). `work` receives the transaction and returns the request whose
// result is wanted, or nothing.
function _run(db, stores, mode, work) {
  return _withTimeout(new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = work(tx);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error ?? req?.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  }), OP_TIMEOUT_MS, 'transaction');
}

// ── Core CRUD ──────────────────────────────────────────────────────────────

export async function get(userId, storeName, key, cryptoKey) {
  try {
    const db = await _openDB(_dbName(userId));
    const row = await _run(db, storeName, 'readonly', tx => tx.objectStore(storeName).get(key));
    const value = row?.value ?? null;
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
    await _run(db, storeName, 'readwrite', tx => tx.objectStore(storeName).put({ key, value: ciphertext }));
  } catch {
    // Silently ignore — app falls back to server-only
  }
}

export async function remove(userId, storeName, key) {
  try {
    const db = await _openDB(_dbName(userId));
    await _run(db, storeName, 'readwrite', tx => tx.objectStore(storeName).delete(key));
  } catch {
    // Silently ignore
  }
}

export async function clearStore(userId, storeName) {
  try {
    const db = await _openDB(_dbName(userId));
    await _run(db, storeName, 'readwrite', tx => tx.objectStore(storeName).clear());
  } catch {
    // Silently ignore
  }
}

export async function clearAll(userId) {
  const dbName = _dbName(userId);
  const cached = _dbCache.get(dbName);
  _dbCache.delete(dbName);
  // Close our own connection first, or the delete would wait on it forever.
  try { (await _withTimeout(cached, OPEN_TIMEOUT_MS, 'open'))?.close(); } catch {}
  try {
    await _withTimeout(new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve(); // proceed even if blocked
    }), OP_TIMEOUT_MS, 'delete');
  } catch {
    // Silently ignore
  }
}

// ── Raw records (caller handles encryption) ───────────────────────────────

// Returns the stored record as-is (still encrypted). Needs no key, so it can
// run in parallel with /auth/me before the DEK has arrived.
export async function readRecord(userId, storeName, key) {
  try {
    const db = await _openDB(_dbName(userId));
    return (await _run(db, storeName, 'readonly', tx => tx.objectStore(storeName).get(key))) ?? null;
  } catch {
    return null;
  }
}

// Clears storeName (and any alsoClear stores) and writes one record, all in
// a single readwrite transaction — the record and its freshness data can
// never be half-written.
export async function replaceStoreWithRecord(userId, storeName, key, fields, alsoClear = []) {
  try {
    const db = await _openDB(_dbName(userId));
    await _run(db, [storeName, ...alsoClear], 'readwrite', (tx) => {
      const os = tx.objectStore(storeName);
      os.clear();
      os.put({ key, ...fields });
      for (const s of alsoClear) tx.objectStore(s).clear();
    });
    return true;
  } catch {
    return false;
  }
}
