"""Shared audit-log writer for admin actions."""
import json
from extensions import app


def write_audit(conn, actor_admin_id, action, target_type=None, target_id=None, detail=None):
    """Insert one row into admin_audit_log. Does NOT commit — caller commits."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO admin_audit_log
                       (actor_admin_id, action, target_type, target_id, detail)
                   VALUES (%s, %s, %s, %s, %s)""",
                (actor_admin_id, action, target_type,
                 str(target_id) if target_id is not None else None,
                 json.dumps(detail) if detail is not None else None),
            )
    except Exception as e:
        app.logger.warning(f'audit write failed (non-fatal): {e}')
