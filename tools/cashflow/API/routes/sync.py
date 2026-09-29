"""
routes/sync.py

GET /sync/state - a cheap fingerprint of everything the web client caches
(transactions, categories, uploads). The client stores the fingerprint next
to its encrypted IndexedDB snapshot and refetches only the parts whose
fingerprint changed, so a return visit with nothing new on the server costs
this one small request instead of re-downloading every transaction.

One round trip: all three fingerprints come from a single statement. The
transactions hash covers every field a write can change (category via
recategorisation/resolve, the id set via upload/delete).
"""
from flask import jsonify
from flask_jwt_extended import get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_SYNC_STATE
from database import get_connection, release_connection
from middleware.user_middleware import require_auth

_FINGERPRINT_SQL = """
    SELECT
      (SELECT md5(count(*)::text || '|' || coalesce(string_agg(
                  id::text || ':' || coalesce(category, '') || ':' || amount::text || ':' || txn_date,
                  ',' ORDER BY id), ''))
         FROM transactions WHERE user_id = %(uid)s),
      (SELECT md5(coalesce(string_agg(
                  name || ':' || coalesce(color, '') || ':' || coalesce(default_color, '')
                  || ':' || coalesce(pending_deletion_at::text, '') || ':' || display_order::text,
                  ',' ORDER BY display_order, name), ''))
         FROM categories),
      (SELECT md5(count(*)::text || '|' || coalesce(max(id), 0)::text)
         FROM uploaded_files WHERE user_id = %(uid)s)
"""


@app.route('/sync/state', methods=['GET'])
@require_auth()
@limiter.limit(RL_SYNC_STATE)
def sync_state():
    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(_FINGERPRINT_SQL, {'uid': current_user})
            transactions_fp, categories_fp, uploads_fp = cur.fetchone()
        return jsonify({
            'transactions': transactions_fp,
            'categories': categories_fp,
            'uploads': uploads_fp,
        }), 200
    except Exception as e:
        app.logger.error(f'Computing sync state failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to check for changes'}), 500
    finally:
        release_connection(conn)
