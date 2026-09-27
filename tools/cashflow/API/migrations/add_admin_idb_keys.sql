-- Admin IDB envelope-encryption key table
-- Separate from user_idb_keys because admin_users is a separate table.
-- enc_dek and iv are AES-256-GCM ciphertext produced by the KEK (IDB_MASTER_KEY env var).
CREATE TABLE IF NOT EXISTS admin_idb_keys (
    admin_user_id INTEGER PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
    enc_dek       TEXT NOT NULL,
    iv            TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
