"""
routes/client_events.py

Client-side failure log: the web app reports failed network calls, timeouts
and boot fallbacks so an admin can see them without opening anyone's devtools.

POST /client-events        signed-in user; batched, sanitised, rate limited
GET  /admin/client-events  any admin; READ ONLY (there is deliberately no
                           write, edit or delete route for admins)

The table is created by migrations/add_client_events.sql. Until it exists,
both routes degrade quietly (POST stores nothing, GET says setup is needed)
rather than erroring, so deploying the code before the SQL is safe.
"""
import json
import random
from datetime import datetime, timedelta, timezone

from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity
from psycopg2 import errors as pg_errors

from extensions import app, limiter
from middleware.user_rate_limits import RL_CLIENT_EVENTS
from middleware.admin_rate_limits import RL_READ_ADMIN
from middleware.user_middleware import require_auth
from middleware.admin_middleware import require_admin_auth
from database import get_connection, release_connection

KINDS = {
    'network_error',   # fetch threw (offline, DNS, CORS, server down)
    'timeout',         # request exceeded its client-side limit
    'http_error',      # 5xx / 429 / 403 / 408
    'slow_response',   # succeeded but took very long (cold start)
    'boot_fallback',   # local cache unusable, loaded from the network instead
    'idb_timeout',     # an IndexedDB open/transaction timed out
    'queue_dropped',   # a queued write permanently failed and was discarded
}

MAX_EVENTS_PER_POST = 25
MAX_ROWS_KEPT = 50_000
RETENTION_DAYS = 30
PRUNE_PROBABILITY = 0.02

_METHODS = {'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'}


def _clip(value, limit):
    if value is None:
        return None
    return str(value)[:limit]


def _int_in(value, lo, hi):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def _clamped(value, lo, hi, default):
    """Parse an int query param and clamp it into [lo, hi]; junk -> default."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def _clean_path(value):
    # Path only: never store a query string (it can carry ids or tokens).
    if not isinstance(value, str):
        return None
    return value.split('?', 1)[0].split('#', 1)[0][:200] or None


def _clean_detail(value):
    """Small flat dict of scalars only, so it can never smuggle in a payload."""
    if not isinstance(value, dict):
        return None
    out = {}
    for k, v in list(value.items())[:8]:
        if isinstance(v, bool) or isinstance(v, (int, float)):
            out[str(k)[:40]] = v
        elif isinstance(v, str):
            out[str(k)[:40]] = v[:100]
    return out or None


def _clean_occurred_at(value, now):
    """Client clock, clamped so a wrong clock can't put rows in the future or
    far in the past. Falls back to the server time."""
    try:
        ts = datetime.fromtimestamp(float(value) / 1000.0, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return now
    if ts > now:
        return now
    if ts < now - timedelta(days=7):
        return now
    return ts


def _clean_event(raw, now):
    if not isinstance(raw, dict):
        return None
    kind = raw.get('kind')
    if kind not in KINDS:
        return None
    method = raw.get('method')
    detail = _clean_detail(raw.get('detail'))
    return (
        _clean_occurred_at(raw.get('at'), now),
        kind,
        method if method in _METHODS else None,
        _clean_path(raw.get('path')),
        _int_in(raw.get('status'), 0, 999),
        _int_in(raw.get('duration_ms'), 0, 3_600_000),
        _clip(raw.get('message'), 300),
        _clean_path(raw.get('page')),
        json.dumps(detail) if detail else None,
    )


def _prune(cur):
    cur.execute("DELETE FROM client_events WHERE created_at < now() - %s * interval '1 day'", (RETENTION_DAYS,))
    cur.execute(
        """DELETE FROM client_events
           WHERE id < (SELECT id FROM client_events ORDER BY id DESC OFFSET %s LIMIT 1)""",
        (MAX_ROWS_KEPT,),
    )


@app.route('/client-events', methods=['POST'])
@require_auth()
@limiter.limit(RL_CLIENT_EVENTS)
def post_client_events():
    user_id = int(get_jwt_identity())
    body = request.get_json(silent=True)
    events = body.get('events') if isinstance(body, dict) else None
    if not isinstance(events, list):
        return jsonify({'error': 'Body must be {"events": [...]}'}), 400

    now = datetime.now(timezone.utc)
    rows = []
    for raw in events[:MAX_EVENTS_PER_POST]:
        row = _clean_event(raw, now)
        if row:
            rows.append((user_id,) + row)
    if not rows:
        return jsonify({'stored': 0}), 200

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO client_events
                       (user_id, occurred_at, kind, method, path, status, duration_ms, message, page, detail)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)""",
                rows,
            )
            if random.random() < PRUNE_PROBABILITY:
                _prune(cur)
        conn.commit()
        return jsonify({'stored': len(rows)}), 200
    except pg_errors.UndefinedTable:
        conn.rollback()
        app.logger.warning('client_events table missing - run migrations/add_client_events.sql')
        return jsonify({'stored': 0, 'skipped': 'not_configured'}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'post_client_events failed for user {user_id}: {e}')
        return jsonify({'error': 'Failed to store events'}), 500
    finally:
        release_connection(conn)


@app.route('/admin/client-events', methods=['GET'])
@require_admin_auth()          # any admin, no extra permission: read-only
@limiter.limit(RL_READ_ADMIN)
def admin_client_events():
    """Newest first.

    Query params:
      hours    int   look-back window (default 168 = 7 days, max 720)
      kind     str   one of KINDS
      user_id  int   only this user's events
      limit    int   default 200, max 500
      offset   int   for paging
    """
    hours = _clamped(request.args.get('hours'), 1, RETENTION_DAYS * 24, 168)
    limit = _clamped(request.args.get('limit'), 1, 500, 200)
    offset = _clamped(request.args.get('offset'), 0, 1_000_000, 0)
    kind = request.args.get('kind') or None
    if kind is not None and kind not in KINDS:
        return jsonify({'error': 'Unknown kind'}), 400
    user_id_raw = request.args.get('user_id')
    user_id = None
    if user_id_raw:
        user_id = _int_in(user_id_raw, 1, 2_147_483_647)
        if user_id is None:
            return jsonify({'error': 'Invalid user_id'}), 400

    # Window + optional user apply to both the list and the per-kind counts;
    # the kind filter only narrows the list (the counts show every kind).
    base_where = ["COALESCE(e.occurred_at, e.created_at) >= now() - %s * interval '1 hour'"]
    base_params = [hours]
    if user_id:
        base_where.append('e.user_id = %s')
        base_params.append(user_id)
    where = list(base_where)
    params = list(base_params)
    if kind:
        where.append('e.kind = %s')
        params.append(kind)
    where_sql = ' AND '.join(where)
    base_sql = ' AND '.join(base_where)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""SELECT e.id, COALESCE(e.occurred_at, e.created_at), e.user_id, u.username,
                           e.kind, e.method, e.path, e.status, e.duration_ms,
                           e.message, e.page, e.detail
                    FROM client_events e
                    LEFT JOIN users u ON u.id = e.user_id
                    WHERE {where_sql}
                    ORDER BY COALESCE(e.occurred_at, e.created_at) DESC, e.id DESC
                    LIMIT %s OFFSET %s""",
                params + [limit, offset],
            )
            rows = cur.fetchall()
            cur.execute(
                f"SELECT e.kind, COUNT(*) FROM client_events e WHERE {base_sql} GROUP BY e.kind",
                base_params,
            )
            summary = {k: n for k, n in cur.fetchall()}
        events = [
            {
                'id': r[0],
                'at': r[1].isoformat() if r[1] else '',
                'user_id': r[2],
                'username': r[3] or ('deleted' if r[2] else ''),
                'kind': r[4],
                'method': r[5] or '',
                'path': r[6] or '',
                'status': r[7],
                'duration_ms': r[8],
                'message': r[9] or '',
                'page': r[10] or '',
                'detail': r[11] or None,
            }
            for r in rows
        ]
        return jsonify({'events': events, 'summary': summary, 'limit': limit, 'offset': offset}), 200
    except pg_errors.UndefinedTable:
        conn.rollback()
        return jsonify({'events': [], 'summary': {}, 'limit': limit, 'offset': offset, 'not_configured': True}), 200
    except Exception as e:
        conn.rollback()
        app.logger.error(f'admin_client_events failed: {e}')
        return jsonify({'error': 'Failed to fetch client events'}), 500
    finally:
        release_connection(conn)
