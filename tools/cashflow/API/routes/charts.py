"""
routes/charts.py

Pre-aggregated spending totals for the Charts screen - computed inside
Postgres via GROUP BY/SUM, so response size is bounded by
(years x months x categories), not by raw transaction count.
"""
from flask import jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_READ_CHARTS
from database import get_connection, release_connection
from checkingName import NEEDS_MANUAL_REVIEW
from shared import TRANSIENT_CATEGORY_VALUES


@app.route('/charts/summary', methods=['GET'])
@jwt_required()
@limiter.limit(RL_READ_CHARTS)
def charts_summary():
    """Pre-aggregated spending totals for the Charts screen - one row
    per (year, category) and, separately, one row per (year, month,
    category). Sums are computed INSIDE Postgres via GROUP BY/SUM - the
    response size is bounded by (years x months x categories), not by
    how many actual transactions produced those totals.
    """
    current_user = int(get_jwt_identity())
    excluded_categories = list(TRANSIENT_CATEGORY_VALUES | {NEEDS_MANUAL_REVIEW})

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                r"""SELECT SUBSTRING(txn_date FROM 7 FOR 4)::INTEGER AS year,
                           category,
                           SUM(ABS(amount)) AS total
                    FROM transactions
                    WHERE user_id = %s
                      AND category IS NOT NULL
                      AND NOT (category = ANY(%s))
                      AND txn_date ~ '^\d{2}/\d{2}/\d{4}$'
                    GROUP BY year, category
                    ORDER BY year""",
                (current_user, excluded_categories),
            )
            yearly = [
                {'year': row[0], 'category': row[1], 'total': float(row[2])}
                for row in cur.fetchall()
            ]

            cur.execute(
                r"""SELECT SUBSTRING(txn_date FROM 7 FOR 4)::INTEGER AS year,
                           SUBSTRING(txn_date FROM 4 FOR 2)::INTEGER AS month,
                           category,
                           SUM(ABS(amount)) AS total
                    FROM transactions
                    WHERE user_id = %s
                      AND category IS NOT NULL
                      AND NOT (category = ANY(%s))
                      AND txn_date ~ '^\d{2}/\d{2}/\d{4}$'
                    GROUP BY year, month, category
                    ORDER BY year, month""",
                (current_user, excluded_categories),
            )
            monthly = [
                {'year': row[0], 'month': row[1], 'category': row[2], 'total': float(row[3])}
                for row in cur.fetchall()
            ]

        return jsonify({'yearly': yearly, 'monthly': monthly}), 200
    except Exception as e:
        app.logger.error(f'Fetching chart summary failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to fetch chart summary'}), 500
    finally:
        release_connection(conn)


