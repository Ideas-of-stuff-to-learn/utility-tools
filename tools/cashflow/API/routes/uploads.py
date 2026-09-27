"""
routes/uploads.py

/uploads/breakdown - returns the actual list of filenames (not just a
count) split into "this session" vs "past". Which rule decides the
split (logout-gated or time-gated, and the duration for time-gated)
is CLIENT-CONTROLLED via query params, sourced from
frontendUploadWindowConfig.jsx - so it can be changed without a
backend redeploy. Falls back to the DEFAULT_* values below if a
caller doesn't send them (e.g. a future CLI tool, or a malformed
request), and every value is validated against a fixed allowlist
before use regardless of where it came from - never trusted blindly
just because it's a query param.
"""
from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from extensions import app, limiter
from middleware.user_rate_limits import RL_READ_UPLOADS
from database import get_connection, release_connection

_VALID_UNITS = {'minutes', 'hours', 'days', 'months', 'years'}
_VALID_MODES = {'logout', 'time_gated'}

DEFAULT_MODE = 'time_gated'
DEFAULT_DURATION_VALUE = 30
DEFAULT_DURATION_UNIT = 'days'


@app.route('/uploads/breakdown', methods=['GET'])
@jwt_required()
@limiter.limit(RL_READ_UPLOADS)
def get_upload_breakdown():
    current_user = int(get_jwt_identity())

    mode = request.args.get('mode', DEFAULT_MODE)
    if mode not in _VALID_MODES:
        mode = DEFAULT_MODE

    unit = request.args.get('duration_unit', DEFAULT_DURATION_UNIT)
    if unit not in _VALID_UNITS:
        unit = DEFAULT_DURATION_UNIT

    try:
        duration_value = int(request.args.get('duration_value', DEFAULT_DURATION_VALUE))
        if duration_value <= 0:
            duration_value = DEFAULT_DURATION_VALUE
    except (TypeError, ValueError):
        duration_value = DEFAULT_DURATION_VALUE

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            if mode == 'time_gated':
                # unit is validated against a fixed allowlist above
                # before ever reaching string formatting, so this stays
                # safe from injection despite not being a %s placeholder -
                # Postgres INTERVAL doesn't accept a parameterized unit
                # directly, but the numeric value itself IS parameterized.
                interval_expr = f"INTERVAL '%s {unit}'"
                cur.execute(
                    f"""SELECT filename, uploaded_at,
                               (uploaded_at >= now() - {interval_expr}) AS is_current
                        FROM uploaded_files
                        WHERE user_id = %s
                        ORDER BY uploaded_at DESC""",
                    (duration_value, current_user),
                )
            else:  # 'logout' mode
                cur.execute(
                    """SELECT f.filename, f.uploaded_at,
                              (f.uploaded_at >= COALESCE(u.session_started_at, 'epoch'::timestamptz)) AS is_current
                       FROM uploaded_files f
                       JOIN users u ON u.id = f.user_id
                       WHERE f.user_id = %s
                       ORDER BY f.uploaded_at DESC""",
                    (current_user,),
                )

            rows = cur.fetchall()

        session_files = []
        past_files = []
        for filename, uploaded_at, is_current in rows:
            entry = {'filename': filename, 'uploaded_at': uploaded_at.isoformat()}
            (session_files if is_current else past_files).append(entry)

        return jsonify({
            'session_files': session_files,
            'past_files': past_files,
            'session_count': len(session_files),
            'past_count': len(past_files),
        }), 200
    except Exception as e:
        app.logger.error(f'Fetching upload breakdown failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to fetch upload breakdown'}), 500
    finally:
        release_connection(conn)