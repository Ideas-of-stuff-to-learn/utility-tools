"""
routes/transactions/categorization_routes.py

The HTTP layer over the categorization pipeline - the old single-shot
/categorize/cached endpoint (kept for any caller still using it in one
go), the phase-split /categorize/cached/exact|merchant|similarity
endpoints (what the frontend actually calls, one phase per HTTP round
trip so results can be applied/shown as soon as they land), the
/categorize/llm endpoint, and /categorize/resolve for manual review /
recategorization. The actual tier logic itself lives in categorise/
and matching/ - this file is just wiring HTTP requests to those.
"""

from time import perf_counter

from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_CATEGORISE_CACHED, RL_CATEGORISE_LLM, RL_CATEGORISE_BATCH
from middleware.user_middleware import require_auth
from database import get_connection, release_connection
from cache import CategoryCache
from categorise.pipeline import run_cache_tiers
from categorise.llm_tier import run_llm_tier
from categorise.exact_tier import combined_status, run_exact_tier
from categorise.merchant_tier import run_merchant_tier
from categorise.similarity_tier import run_similarity_tier

from matching import load_categories
from checkingName import NEEDS_MANUAL_REVIEW
from shared import update_transaction_categories


@app.route('/categorize/cached', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_CACHED)
def categorize_cached():
    current_user = int(get_jwt_identity())
    data = request.get_json()

    if not data or 'transactions' not in data:
        return jsonify({'error': 'Request must contain "transactions"'}), 400

    transactions = data['transactions']
    if not isinstance(transactions, list) or not transactions:
        return jsonify({'error': 'transactions must be a non-empty list'}), 400

    conn = get_connection()
    try:
        result = run_cache_tiers(transactions, current_user, conn)
        update_transaction_categories(conn, current_user, result)
        conn.commit()
        return jsonify({'transactions': result}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Cache tier failed for user {current_user}: {e}')
        return jsonify({'error': 'Cache lookup failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categorize/cached/exact', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_CACHED)
def categorize_cached_exact():
    current_user = int(get_jwt_identity())
    data = request.get_json()

    if not data or 'transactions' not in data:
        return jsonify({'error': 'Request must contain "transactions"'}), 400

    transactions = data['transactions']
    if not isinstance(transactions, list) or not transactions:
        return jsonify({'error': 'transactions must be a non-empty list'}), 400

    conn = get_connection()
    try:
        backend_started_at = perf_counter()

        exact_started_at = perf_counter()
        result = run_exact_tier(transactions, current_user, conn)
        exact_ms = (perf_counter() - exact_started_at) * 1000

        update_transaction_categories(conn, current_user, result)
        conn.commit()

        total_backend_ms = (perf_counter() - backend_started_at) * 1000

        return jsonify({
            'transactions': result,
            'timings': {
                'exact_ms': exact_ms,
                'total_backend_ms': total_backend_ms,
            },
        }), 200

    except Exception as e:
        conn.rollback()
        app.logger.error(f'Exact cache tier failed for user {current_user}: {e}')
        return jsonify({'error': 'Cache lookup failed - please try again'}), 500

    finally:
        release_connection(conn)


@app.route('/categorize/cached/merchant', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_CACHED)
def categorize_cached_merchant():
    current_user = int(get_jwt_identity())
    data = request.get_json()

    if not data or 'transactions' not in data:
        return jsonify({'error': 'Request must contain "transactions"'}), 400

    transactions = data['transactions']
    if not isinstance(transactions, list) or not transactions:
        return jsonify({'error': 'transactions must be a non-empty list'}), 400

    conn = get_connection()
    try:
        result = run_merchant_tier(transactions, conn)
        update_transaction_categories(conn, current_user, result)
        conn.commit()
        return jsonify({'transactions': result}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Merchant tier failed for user {current_user}: {e}')
        return jsonify({'error': 'Merchant lookup failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categorize/cached/similarity', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_CACHED)
def categorize_cached_similarity():
    current_user = int(get_jwt_identity())
    data = request.get_json()

    if not data or 'transactions' not in data:
        return jsonify({'error': 'Request must contain "transactions"'}), 400

    transactions = data['transactions']
    if not isinstance(transactions, list) or not transactions:
        return jsonify({'error': 'transactions must be a non-empty list'}), 400

    conn = get_connection()
    try:
        result = run_similarity_tier(transactions, conn)
        update_transaction_categories(conn, current_user, result)
        conn.commit()
        return jsonify({'transactions': result}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Similarity tier failed for user {current_user}: {e}')
        return jsonify({'error': 'Similarity lookup failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categorize/llm', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_LLM)
def categorize_llm():
    current_user = int(get_jwt_identity())
    data = request.get_json()

    if not data or 'transactions' not in data:
        return jsonify({'error': 'Request must contain "transactions"'}), 400

    transactions = data['transactions']
    if not isinstance(transactions, list) or not transactions:
        return jsonify({'error': 'transactions must be a non-empty list'}), 400

    batch_size_kwargs = {}
    if 'batch_size' in data:
        try:
            batch_size = int(data['batch_size'])
        except (TypeError, ValueError):
            return jsonify({'error': 'batch_size must be an integer'}), 400
        if not (1 <= batch_size <= 2000):
            return jsonify({'error': 'batch_size must be between 1 and 2000'}), 400
        batch_size_kwargs['batch_size'] = batch_size

    gemini_timeout_kwargs = {}
    if 'gemini_timeout_ms' in data:
        try:
            gemini_timeout_ms = int(data['gemini_timeout_ms'])
        except (TypeError, ValueError):
            return jsonify({'error': 'gemini_timeout_ms must be an integer'}), 400
        if not (1000 <= gemini_timeout_ms <= 90000):
            return jsonify({'error': 'gemini_timeout_ms must be between 1000 and 90000'}), 400
        gemini_timeout_kwargs['gemini_timeout_ms'] = gemini_timeout_ms

    conn = get_connection()
    try:
        backend_started_at = perf_counter()

        llm_result = run_llm_tier(
            transactions,
            current_user,
            conn,
            **batch_size_kwargs,
            **gemini_timeout_kwargs
        )

        result = llm_result['transactions']
        timings = llm_result['timings']

        update_transaction_categories(conn, current_user, result)

        conn.commit()

        timings['total_backend_ms'] = (perf_counter() - backend_started_at) * 1000

        return jsonify({
            'transactions': result,
            'timings': timings,
        }), 200

    except Exception as e:
        conn.rollback()
        app.logger.error(f'LLM tier failed for user {current_user}: {e}')
        return jsonify({'error': 'LLM categorisation failed - please try again'}), 500
    finally:
        release_connection(conn)


@app.route('/categorize/resolve', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_CACHED)
def resolve_manual():
    current_user = int(get_jwt_identity())
    data = request.get_json()

    if not data or 'resolutions' not in data:
        return jsonify({'error': 'Request must contain "resolutions"'}), 400

    resolutions = data['resolutions']
    if not isinstance(resolutions, list) or not resolutions:
        return jsonify({'error': 'resolutions must be a non-empty list'}), 400

    conn = get_connection()
    try:
        valid_categories = set(load_categories(conn))
        personal_cache = CategoryCache(conn, scope='personal', user_id=current_user)
        global_cache = CategoryCache(conn, scope='global')
        personal_cache.preload()
        global_cache.preload()

        updated = []
        skipped = []

        for r in resolutions:
            desc = r.get('description')
            date = r.get('date')
            amount = r.get('amount')
            category = r.get('category')

            if not all([desc, date, category]) or amount is None:
                skipped.append(r)
                continue
            if category not in valid_categories or category == NEEDS_MANUAL_REVIEW:
                skipped.append(r)
                continue

            amount_str = str(amount)

            resolved = personal_cache.resolve_record(desc, date, amount_str, category)

            if not resolved:
                removed_from_personal = personal_cache.remove_record(desc, date, amount_str, category=None)
                if not removed_from_personal:
                    global_cache.remove_record(desc, date, amount_str, category=None)
                personal_cache.add_record(desc, date, amount_str, category)

            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE transactions SET category = %s
                       WHERE user_id = %s AND description = %s
                         AND txn_date = %s AND amount = %s""",
                    (category, current_user, desc, date, amount),
                )

            updated.append({'description': desc, 'date': date, 'amount': amount, 'category': category})

        if personal_cache.dirty:
            personal_cache.save()
        if global_cache.dirty:
            global_cache.save()

        conn.commit()
        return jsonify({'updated': updated, 'skipped': skipped}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Resolve failed for user {current_user}: {e}')
        return jsonify({'error': 'Resolve failed - please try again'}), 500
    finally:
        release_connection(conn)
        
        
@app.route('/categorize/resolve-and-exit', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_BATCH)
def resolve_and_exit():
    """Combined exit endpoint: saves any accumulated picks then bulk-resolves
    whatever is still NEEDS_MANUAL_REVIEW to Other, all in one DB transaction.
    Replaces the two-round-trip pattern of resolve → resolve-remaining-to-other.
    Body: { resolutions: [...] }  (may be empty list if no picks were made)
    """
    current_user = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    resolutions = data.get('resolutions', [])

    conn = get_connection()
    try:
        valid_categories = set(load_categories(conn))
        personal_cache = CategoryCache(conn, scope='personal', user_id=current_user)
        global_cache = CategoryCache(conn, scope='global')
        personal_cache.preload()
        global_cache.preload()

        updated = []
        skipped = []

        for r in resolutions:
            desc = r.get('description')
            date = r.get('date')
            amount = r.get('amount')
            category = r.get('category')

            if not all([desc, date, category]) or amount is None:
                skipped.append(r)
                continue
            if category not in valid_categories or category == NEEDS_MANUAL_REVIEW:
                skipped.append(r)
                continue

            amount_str = str(amount)
            resolved = personal_cache.resolve_record(desc, date, amount_str, category)
            if not resolved:
                removed = personal_cache.remove_record(desc, date, amount_str, category=None)
                if not removed:
                    global_cache.remove_record(desc, date, amount_str, category=None)
                personal_cache.add_record(desc, date, amount_str, category)

            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE transactions SET category = %s
                       WHERE user_id = %s AND description = %s
                         AND txn_date = %s AND amount = %s""",
                    (category, current_user, desc, date, amount),
                )

            updated.append({'description': desc, 'date': date, 'amount': amount, 'category': category})

        if personal_cache.dirty:
            personal_cache.save()
        if global_cache.dirty:
            global_cache.save()

        # Bulk-resolve whatever is still NEEDS_MANUAL_REVIEW to Other
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE transactions SET category = 'Other'
                   WHERE user_id = %s AND category = %s
                   RETURNING id""",
                (current_user, NEEDS_MANUAL_REVIEW),
            )
            remaining_resolved = cur.rowcount

        conn.commit()
        return jsonify({'updated': updated, 'skipped': skipped, 'remaining_resolved': remaining_resolved}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Resolve-and-exit failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to save and exit'}), 500
    finally:
        release_connection(conn)


@app.route('/categorize/resolve-remaining-to-other', methods=['POST'])
@require_auth()
@limiter.limit(RL_CATEGORISE_BATCH)
def resolve_remaining_to_other():
    """The sendBeacon safety net for the manual-review blocking flow -
    if someone leaves mid-flow (closes the tab, force-quits) before
    finishing every transaction, this bulk-resolves whatever's STILL
    NEEDS_MANUAL_REVIEW for them into the 'Other' category, so nothing
    is ever left in a broken, half-finished state. Takes no body at
    all - sendBeacon can't easily send custom headers/auth, but the
    httpOnly JWT cookie is sent automatically with any same-origin
    request including sendBeacon, so @require_auth() still works here
    unchanged.
    """
    current_user = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE transactions SET category = 'Other'
                   WHERE user_id = %s AND category = %s
                   RETURNING id""",
                (current_user, NEEDS_MANUAL_REVIEW),
            )
            resolved_count = cur.rowcount
        conn.commit()
        return jsonify({'status': 'ok', 'resolved': resolved_count}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Resolve-remaining-to-other failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to resolve remaining transactions'}), 500
    finally:
        release_connection(conn)