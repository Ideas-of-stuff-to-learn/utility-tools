/**
 * idb/crypto.js
 *
 * AES-256-GCM encryption/decryption for IndexedDB values.
 * The CryptoKey is derived from the server-issued DEK (base64, 32 bytes)
 * and held in JS memory only — never written to any storage.
 *
 * Each encrypted value: [12-byte IV][ciphertext] packed into a Uint8Array,
 * base64-encoded for clean IDB storage.
 */

/**
 * Import a base64-encoded 32-byte DEK as a non-extractable AES-256-GCM key.
 * @param {string} base64Dek
 * @returns {Promise<CryptoKey>}
 */
export async function importKey(base64Dek) {
  const raw = Uint8Array.from(atob(base64Dek), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,  // non-extractable — key cannot be read back out of the runtime
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a plaintext string. Returns a base64 string: [IV][ciphertext].
 * @param {CryptoKey} cryptoKey
 * @param {string} plaintext
 * @returns {Promise<string>}
 */
export async function encrypt(cryptoKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded,
  );
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded [IV][ciphertext] blob back to a plaintext string.
 * @param {CryptoKey} cryptoKey
 * @param {string} base64Blob
 * @returns {Promise<string>}
 */
export async function decrypt(cryptoKey, base64Blob) {
  const combined = Uint8Array.from(atob(base64Blob), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}
