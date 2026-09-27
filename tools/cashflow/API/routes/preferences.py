"""
routes/preferences.py

GET  /preferences      → return all saved preferences for the current user
PUT  /preferences      → upsert one or more keys (partial update supported)

Preferences are stored as a single JSONB column on the users table so no
extra join is ever needed. Each key is namespaced: 'columnWidths',
'stackOrder', 'stackOrderPersist', 'mrPendingPicks'.
"""
import json
from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_READ_PREFERENCES, RL_WRITE_PREFERENCES
from database import get_connection, release_connection
from middleware.user_middleware import require_auth


@app.route('/preferences', methods=['GET'])
@require_auth()
@limiter.limit(RL_READ_PREFERENCES)
def get_preferences():
    user_id = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT preferences FROM users WHERE id = %s",
                (user_id,)
            )
            row = cur.fetchone()
            prefs = row[0] if (row and row[0]) else {}
        return jsonify(prefs), 200
    except Exception as e:
        app.logger.error(f'get_preferences failed for user {user_id}: {e}')
        return jsonify({'error': 'Failed to load preferences'}), 500
    finally:
        release_connection(conn)


@app.route('/preferences', methods=['PUT'])
@require_auth()
@limiter.limit(RL_WRITE_PREFERENCES)
def put_preferences():
    user_id = int(get_jwt_identity())
    updates = request.get_json(silent=True)
    if not isinstance(updates, dict):
        return jsonify({'error': 'Body must be a JSON object'}), 400

    # idb_key is managed server-side only — clients must never overwrite it
    _BLOCKED_PREF_KEYS = {'idb_key'}
    updates = {k: v for k, v in updates.items() if k not in _BLOCKED_PREF_KEYS}

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # Merge incoming keys into existing preferences (partial update)
            cur.execute(
                """
                UPDATE users
                SET preferences = COALESCE(preferences, '{}'::jsonb) || %s::jsonb
                WHERE id = %s
                RETURNING preferences
                """,
                (json.dumps(updates), user_id)
            )
            updated = cur.fetchone()
            conn.commit()
        return jsonify(updated[0] if updated else {}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'put_preferences failed for user {user_id}: {e}')
        return jsonify({'error': 'Failed to save preferences'}), 500
    finally:
        release_connection(conn)
