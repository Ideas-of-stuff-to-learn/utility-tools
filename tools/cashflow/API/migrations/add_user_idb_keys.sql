-- Migration: add user_idb_keys table for encrypted IDB DEK storage
-- Run once against the Supabase DB.
-- Each row holds a per-user AES-256-GCM encrypted Data Encryption Key.
-- The Key Encryption Key (KEK) lives in the IDB_MASTER_KEY env var — never here.

CREATE TABLE IF NOT EXISTS user_idb_keys (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enc_dek    TEXT        NOT NULL,  -- base64(AES-256-GCM ciphertext of the 32-byte DEK)
    iv         TEXT        NOT NULL,  -- base64(12-byte IV used during encryption)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
