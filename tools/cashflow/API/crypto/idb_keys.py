"""
crypto/idb_keys.py

Envelope encryption for per-user IndexedDB DEKs (Data Encryption Keys).

Architecture:
  KEK (Key Encryption Key) — lives in IDB_MASTER_KEY env var, never in DB
  DEK (Data Encryption Key) — random 32 bytes per user, stored AES-256-GCM
                               encrypted with the KEK in user_idb_keys table

A DB dump reveals only encrypted DEK blobs. Without the KEK from the server
environment they are unreadable. This mirrors the AWS KMS envelope pattern.
"""

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# Loaded once at module import — app startup fails fast if missing.
_KEK_HEX = os.environ.get('IDB_MASTER_KEY', '')
if not _KEK_HEX:
    raise RuntimeError('IDB_MASTER_KEY environment variable is not set — cannot start')
try:
    _KEK: bytes = bytes.fromhex(_KEK_HEX)
    if len(_KEK) != 32:
        raise ValueError('IDB_MASTER_KEY must be 64 hex characters (32 bytes)')
except ValueError as e:
    raise RuntimeError(f'IDB_MASTER_KEY is invalid: {e}') from e

_AESGCM = AESGCM(_KEK)


def _generate_dek() -> bytes:
    return os.urandom(32)


def _encrypt_dek(dek: bytes) -> tuple[str, str]:
    """Returns (enc_dek_b64, iv_b64) — both base64-encoded."""
    iv = os.urandom(12)
    ciphertext = _AESGCM.encrypt(iv, dek, None)
    return base64.b64encode(ciphertext).decode(), base64.b64encode(iv).decode()


def _decrypt_dek(enc_dek_b64: str, iv_b64: str) -> bytes:
    ciphertext = base64.b64decode(enc_dek_b64)
    iv = base64.b64decode(iv_b64)
    return _AESGCM.decrypt(iv, ciphertext, None)


def get_or_create_admin_dek(conn, admin_user_id: int) -> str:
    """Same envelope-encryption pattern as get_or_create_dek but for admin_users.
    Uses admin_idb_keys table (references admin_users, not users).
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT enc_dek, iv FROM admin_idb_keys WHERE admin_user_id = %s",
            (admin_user_id,),
        )
        row = cur.fetchone()

    if row:
        dek = _decrypt_dek(row[0], row[1])
    else:
        dek = _generate_dek()
        enc_dek_b64, iv_b64 = _encrypt_dek(dek)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO admin_idb_keys (admin_user_id, enc_dek, iv)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (admin_user_id) DO NOTHING""",
                (admin_user_id, enc_dek_b64, iv_b64),
            )
        conn.commit()

    return base64.b64encode(dek).decode()


def get_or_create_dek(conn, user_id: int) -> str:
    """Returns the plaintext DEK for this user as a base64 string (safe to
    send to the client over HTTPS — held in JS memory only, never persisted).
    Creates and stores a new encrypted DEK if one does not exist yet.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT enc_dek, iv FROM user_idb_keys WHERE user_id = %s",
            (user_id,),
        )
        row = cur.fetchone()

    if row:
        dek = _decrypt_dek(row[0], row[1])
    else:
        dek = _generate_dek()
        enc_dek_b64, iv_b64 = _encrypt_dek(dek)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_idb_keys (user_id, enc_dek, iv)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (user_id) DO NOTHING""",
                (user_id, enc_dek_b64, iv_b64),
            )
        conn.commit()

    return base64.b64encode(dek).decode()
