"""
routes/transactions/crud.py

Reading, deleting, and counting the current user's own transactions -
no parsing, no categorization, just plain CRUD over the transactions
table (and the uploaded_files table for the count endpoint).
"""

from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_READ_STANDARD, RL_READ_TRANSACTIONS, RL_READ_UPLOADS
# RL_READ_STANDARD still used by DELETE /transactions below
from database import get_connection, release_connection
from middleware.user_middleware import require_auth


@app.route('/transactions', methods=['GET'])
@require_auth()
@limiter.limit(RL_READ_TRANSACTIONS)
def get_transactions():
    """Returns transactions for the logged-in user. Supports optional
    pagination via ?offset=N&limit=N query params - if neither is given,
    returns all rows (the old behaviour, kept for CLI callers and any
    other client that fetches in one shot). When limit is given, also
    returns a `total` count in the response so the client knows when it
    has fetched everything without needing a separate request.

    Ordered by id (insertion order) rather than date, since txn_date is
    stored as free-form text and doesn't sort chronologically as a string
    - the frontend re-sorts by parsed date for display anyway.
    """
    current_user = int(get_jwt_identity())

    raw_offset = request.args.get('offset')
    raw_limit = request.args.get('limit')
    paginated = raw_limit is not None

    try:
        offset = max(0, int(raw_offset)) if raw_offset is not None else 0
        limit = min(max(1, int(raw_limit)), 2000) if raw_limit is not None else None
    except (TypeError, ValueError):
        return jsonify({'error': 'offset and limit must be integers'}), 400

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            if paginated:
                cur.execute(
                    "SELECT COUNT(*) FROM transactions WHERE user_id = %s",
                    (current_user,),
                )
                total = cur.fetchone()[0]
                cur.execute(
                    """SELECT id, txn_date, description, amount, category
                       FROM transactions
                       WHERE user_id = %s
                       ORDER BY id
                       LIMIT %s OFFSET %s""",
                    (current_user, limit, offset),
                )
            else:
                total = None
                cur.execute(
                    """SELECT id, txn_date, description, amount, category
                       FROM transactions
                       WHERE user_id = %s
                       ORDER BY id""",
                    (current_user,),
                )
            rows = cur.fetchall()

        transactions = [
            {
                'id': row[0],
                'date': row[1],
                'description': row[2],
                'amount': float(row[3]),
                'category': row[4],
            }
            for row in rows
        ]

        response = {'transactions': transactions}
        if paginated:
            response['total'] = total
            response['offset'] = offset
            response['limit'] = limit
        return jsonify(response), 200
    except Exception as e:
        app.logger.error(f'Fetching transaction history failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to fetch transaction history'}), 500
    finally:
        release_connection(conn)


@app.route('/transactions', methods=['DELETE'])
@require_auth()
@limiter.limit(RL_READ_STANDARD)
def delete_transactions():
    """Deletes one or more of the CURRENT USER's own transactions by id.
    Not admin-only, unlike the category endpoints - this is a personal
    action on your own data, not global shared structure. Scoped by
    `user_id = current_user` in the WHERE clause (not just `id = ANY`)
    so there's no way to delete another user's rows even by guessing
    ids - any id that doesn't belong to you is silently ignored rather
    than erroring, same as it just wouldn't exist from your perspective.

    Returns how many rows actually got deleted, which can legitimately
    be less than len(ids) if the caller's local state was stale (e.g.
    something already deleted in another session) - not treated as an
    error, same reasoning as skipped rows in /categorize/resolve.
    """
    data = request.get_json() or {}
    ids = data.get('ids')

    if not ids or not isinstance(ids, list):
        return jsonify({'error': 'ids must be a non-empty list'}), 400
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        return jsonify({'error': 'ids must be a list of integers'}), 400

    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM transactions WHERE user_id = %s AND id = ANY(%s)",
                (current_user, ids),
            )
            deleted_count = cur.rowcount
        conn.commit()
        return jsonify({'status': 'ok', 'deleted': deleted_count}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Deleting transactions failed for user {current_user}: {e}')
        return jsonify({'error': 'Delete failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/uploads/count', methods=['GET'])
@require_auth()
@limiter.limit(RL_READ_UPLOADS)
def get_upload_count():
    """Counts upload EVENTS (re-uploading the same file adds to this),
    not distinct filenames.
    """
    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM uploaded_files WHERE user_id = %s", (current_user,))
            count = cur.fetchone()[0]
        return jsonify({'count': count}), 200
    except Exception as e:
        app.logger.error(f'Fetching upload count failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to fetch upload count'}), 500
    finally:
        release_connection(conn)