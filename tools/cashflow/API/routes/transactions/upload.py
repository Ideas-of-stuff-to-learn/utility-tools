"""
routes/transactions/upload.py

CSV/Excel upload and parsing - the /api/parse-csv route, plus the
Excel-specific row-reading helper. Accepts .csv, .xlsx, and .xls,
normalizing all three into identical (date, description, amount)
string tuples before anything below the row-reading step needs to
know or care which format the file originally was.
"""

import csv
import io
import re

import openpyxl
import xlrd

from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity
from middleware.user_middleware import require_auth
from psycopg2.extras import execute_values

from extensions import app, limiter
from middleware.user_rate_limits import RL_UPLOAD
from database import get_connection, release_connection
from .shared_helpers import sanitize_cell, MAX_CSV_FILE_SIZE_BYTES
from routes.billing import get_billing_status


def _rows_from_excel(raw_bytes, filename):
    """Yields (date, description, amount) string tuples from an Excel
    file - .xlsx via openpyxl, .xls (the older binary format) via
    xlrd, since these are genuinely different file formats needing
    separate libraries. Cell values are converted to plain strings
    here specifically so downstream code (sanitize_cell, the dedup
    key, float parsing) can treat every row identically regardless of
    whether it originally came from a CSV, .xlsx, or .xls file - the
    rest of parse_csv() below has no idea which format it started as.
    """
    if filename.lower().endswith('.xlsx'):
        workbook = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        sheet = workbook.active
        for row in sheet.iter_rows(values_only=True):
            if row is None or len(row) < 3:
                continue
            yield tuple(str(cell).strip() if cell is not None else '' for cell in row[:3])
    else:  # .xls
        workbook = xlrd.open_workbook(file_contents=raw_bytes)
        sheet = workbook.sheet_by_index(0)
        for row_index in range(sheet.nrows):
            row = sheet.row_values(row_index)
            if len(row) < 3:
                continue
            yield tuple(str(cell).strip() if cell != '' else '' for cell in row[:3])


@app.route('/api/parse-csv', methods=['POST'])
@require_auth()
@limiter.limit(RL_UPLOAD)
def parse_csv():
    current_user = int(get_jwt_identity())

    # ── Base-tier upload cap ──────────────────────────────────────────────────
    # Base users are limited to upload_cap_base uploads per 24 hours, and to
    # 1 file per upload batch. If billing tables don't exist yet, allow upload.
    billing = {'tier': 'base', 'active_trial': None}
    files_per_action_cap = 5  # default; overridden from billing_settings below
    conn_check = get_connection()
    try:
        billing = get_billing_status(conn_check, current_user)
        if billing.get('tier') != 'pro' and not billing.get('active_trial'):
            try:
                with conn_check.cursor() as cur:
                    cur.execute("""
                        SELECT key, value FROM billing_settings
                         WHERE key IN ('upload_cap_base', 'upload_files_per_action_base')
                    """)
                    settings = {r[0]: int(r[1]) for r in cur.fetchall()}
                upload_cap              = settings.get('upload_cap_base', 1)
                files_per_action_cap    = settings.get('upload_files_per_action_base', 5)

                with conn_check.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) FROM uploads WHERE user_id = %s"
                        "  AND created_at >= NOW() - INTERVAL '1 day'",
                        (current_user,),
                    )
                    uploads_today = cur.fetchone()[0]

                if uploads_today >= upload_cap:
                    return jsonify({
                        'error': (
                            f'Daily upload limit reached. Base accounts get {upload_cap} upload action'
                            f'{"s" if upload_cap != 1 else ""} per day. Upgrade for unlimited uploads.'
                        ),
                        'code': 'upload_cap_reached',
                        'upload_cap': upload_cap,
                        'uploads_today': uploads_today,
                    }), 403
            except Exception:
                pass  # billing tables not yet migrated — use defaults
    finally:
        release_connection(conn_check)

    if 'files' not in request.files:
        return jsonify({"error": "No files provided"}), 400

    uploaded_files = request.files.getlist('files')

    # Base-tier: cap files per upload action
    is_base = billing.get('tier') != 'pro' and not billing.get('active_trial')
    if is_base and len(uploaded_files) > files_per_action_cap:
        return jsonify({
            'error': f'Base accounts can upload up to {files_per_action_cap} files per action. Upgrade for unlimited.',
            'code': 'files_per_action_exceeded',
            'files_per_action_cap': files_per_action_cap,
        }), 403
    parsed_rows = []
    seen_lines = set()
    # Which dedup_keys each filename first introduced within this
    # request. Used after the DB insert to work out which files (if
    # any) actually contributed brand-new data, vs. ones that turned
    # out to be pure re-uploads/subsets of what's already stored.
    file_dedup_keys = {}

    # If the same batch contains both "file.csv" and "file - Copy.csv",
    # prefer the original. Strip trailing copy suffixes to detect this.
    _copy_pattern = re.compile(r'\s*-\s*copy(\s*\(\d+\))?\s*$', re.IGNORECASE)

    def _base_name(fname):
        stem, _, ext = fname.rpartition('.')
        stem_stripped = _copy_pattern.sub('', stem).rstrip()
        return f"{stem_stripped}.{ext}" if stem_stripped else fname

    batch_base_names = {}  # base_name -> canonical filename already in this batch
    batch_copy_duplicates = set()  # filenames identified as copies within this batch
    for file in uploaded_files:
        fname = file.filename
        base = _base_name(fname)
        is_copy = base != fname  # True when fname had a copy suffix stripped

        if base in batch_base_names:
            existing = batch_base_names[base]
            existing_is_copy = _base_name(existing) != existing
            if is_copy:
                # Incoming file is a copy — always discard it
                batch_copy_duplicates.add(fname)
            elif existing_is_copy:
                # Incoming file is the original; the copy got there first — swap
                batch_copy_duplicates.add(existing)
                batch_base_names[base] = fname
            else:
                # Two non-copy files with the same effective name — keep first
                batch_copy_duplicates.add(fname)
        else:
            batch_base_names[base] = fname

    for file in uploaded_files:
        # Skip files identified as copy-variants of another file in this
        # same batch — they'll be reported as batch_copy_duplicates below.
        if file.filename in batch_copy_duplicates:
            continue

        filename_lower = file.filename.lower()
        is_csv = filename_lower.endswith('.csv')
        is_excel = filename_lower.endswith('.xlsx') or filename_lower.endswith('.xls')

        if not (is_csv or is_excel):
            continue

        raw_bytes = file.stream.read()

        if len(raw_bytes) > MAX_CSV_FILE_SIZE_BYTES:
            app.logger.warning(f"User {current_user} uploaded oversized file: {file.filename} ({len(raw_bytes)} bytes)")
            continue

        this_file_keys = []

        if is_csv:
            try:
                file_stream = io.StringIO(raw_bytes.decode("utf-8"), newline=None)
            except UnicodeDecodeError:
                app.logger.warning(f"User {current_user} uploaded non-UTF-8 file: {file.filename}")
                continue
            row_source = csv.reader(file_stream)
        else:
            try:
                row_source = _rows_from_excel(raw_bytes, file.filename)
            except Exception as e:
                app.logger.warning(f"User {current_user} uploaded unreadable Excel file: {file.filename} ({e})")
                continue

        for row in row_source:
            if not row or len(row) < 3:
                continue

            raw_date = row[0].strip()
            raw_description = row[1].strip()
            raw_amount = row[2].strip()

            if not raw_date or not raw_description:
                continue

            try:
                amount = float(
                    raw_amount
                    .replace(',', '')
                    .replace('£', '')
                    .replace('$', '')
                    .replace('"', '')
                )
            except ValueError:
                # Basic safety check: a row whose amount can't be
                # parsed at all is malformed, not a legitimate
                # zero-value transaction - skip it rather than
                # silently fabricating a 0.0 amount.
                continue

            # Same construction as before (raw stripped columns 0-2),
            # kept byte-identical so it still matches dedup_keys
            # already stored in the DB from before this change.
            normalized_line = f"{raw_date}|{raw_description}|{raw_amount}"

            if normalized_line not in seen_lines:
                seen_lines.add(normalized_line)
                this_file_keys.append(normalized_line)

                parsed_rows.append({
                    "date": sanitize_cell(raw_date),
                    "description": sanitize_cell(raw_description),
                    "amount": amount,
                    "dedup_key": normalized_line,
                })

        # Basic CSV check: a file that yielded no usable rows at all
        # (wrong format, empty, header-only, garbage) was never really
        # "processed" - it shouldn't be recorded as an accepted upload.
        if not this_file_keys:
            app.logger.warning(f"User {current_user} uploaded file with no valid rows: {file.filename}")
            continue

        file_dedup_keys[file.filename] = this_file_keys

    all_parsed_rows = []
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            resolved_by_dedup_key = {}
            newly_inserted_keys = set()

            if parsed_rows:
                inserted = execute_values(
                    cur,
                    """INSERT INTO transactions (user_id, txn_date, description, amount, category, dedup_key)
                       VALUES %s
                       ON CONFLICT (user_id, dedup_key) DO NOTHING
                       RETURNING id, category, dedup_key""",
                    [
                        (current_user, r["date"], r["description"], r["amount"], None, r["dedup_key"])
                        for r in parsed_rows
                    ],
                    template="(%s, %s, %s, %s, %s, %s)",
                    fetch=True,
                )
                for txn_id, category, dedup_key in inserted:
                    resolved_by_dedup_key[dedup_key] = (txn_id, category)
                    newly_inserted_keys.add(dedup_key)

                missing_dedup_keys = [
                    r["dedup_key"] for r in parsed_rows
                    if r["dedup_key"] not in resolved_by_dedup_key
                ]
                if missing_dedup_keys:
                    cur.execute(
                        """SELECT id, category, dedup_key FROM transactions
                           WHERE user_id = %s AND dedup_key = ANY(%s)""",
                        (current_user, missing_dedup_keys),
                    )
                    for txn_id, category, dedup_key in cur.fetchall():
                        resolved_by_dedup_key[dedup_key] = (txn_id, category)

                for r in parsed_rows:
                    transaction_id, existing_category = resolved_by_dedup_key[r["dedup_key"]]
                    all_parsed_rows.append({
                        "id": transaction_id,
                        "date": r["date"],
                        "description": r["description"],
                        "amount": r["amount"],
                        "category": existing_category,
                    })

            # A file only counts toward the upload total if it actually
            # contributed at least one dedup_key that was genuinely new
            # to the DB (i.e. survived ON CONFLICT DO NOTHING above).
            # An exact re-upload of a file already on record - or a
            # multi-month file where every row turns out to already
            # exist - contributes nothing new, so it doesn't increment.
            # This runs in the SAME transaction as the transaction
            # insert, so if the request rolls back, the count doesn't
            # move either.
            files_with_new_data = [
                filename for filename, keys in file_dedup_keys.items()
                if any(k in newly_inserted_keys for k in keys)
            ]

            if files_with_new_data:
                execute_values(
                    cur,
                    "INSERT INTO uploaded_files (user_id, filename) VALUES %s",
                    [(current_user, filename) for filename in files_with_new_data],
                    template="(%s, %s)",
                )

            # Work out which submitted files were pure duplicates and why.
            # pure_duplicate_filenames = file already in uploaded_files for this user (same name, same data seen before).
            # pure_duplicate_contents  = new filename but every dedup_key already existed (different name, same data).
            submitted_filenames = list(file_dedup_keys.keys())
            pure_duplicates = [f for f in submitted_filenames if f not in files_with_new_data]

            duplicate_filenames = []
            duplicate_contents = []
            if pure_duplicates:
                cur.execute(
                    "SELECT filename FROM uploaded_files WHERE user_id = %s AND filename = ANY(%s)",
                    (current_user, pure_duplicates),
                )
                known_filenames = {row[0] for row in cur.fetchall()}
                for f in pure_duplicates:
                    if f in known_filenames:
                        duplicate_filenames.append(f)
                    else:
                        duplicate_contents.append(f)

        conn.commit()
    except Exception as e:
        conn.rollback()
        app.logger.error(f'Storing parsed transactions failed for user {current_user}: {e}')
        return jsonify({'error': 'Failed to store parsed transactions - please try again'}), 500
    finally:
        release_connection(conn)

    app.logger.info(f"User {current_user} parsed {len(all_parsed_rows)} transactions from {len(uploaded_files)} file(s)")
    return jsonify({
        "transactions": all_parsed_rows,
        "duplicate_filenames": duplicate_filenames,
        "duplicate_contents": duplicate_contents,
        "batch_copy_duplicates": list(batch_copy_duplicates),
        "successful_count": len(files_with_new_data),
    })