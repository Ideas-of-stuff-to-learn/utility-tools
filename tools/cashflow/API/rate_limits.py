"""
rate_limits.py

Single source of truth for every Flask-Limiter rate limit in the backend.
Change a value here and it propagates to every route that uses it.

Format: "N per period"  where period = second / minute / hour / day
Combine: "5 per minute; 50 per day"

─────────────────────────────────────────────────────────────────────────────
DISABLE SWITCHES  (set True to bypass — testing / debugging only)
─────────────────────────────────────────────────────────────────────────────
  DISABLE_ALL_RATE_LIMITS          → kills every limit in one toggle (line 33)

  Per-endpoint / per-group flags below are only checked when DISABLE_ALL=False.
  Each flag is named after the endpoint or group it covers — set True to bypass
  just that one while leaving everything else active.

  All constants are callables, not plain strings, so Flask-Limiter evaluates
  them on every request (not at import time) — no server restart needed.
─────────────────────────────────────────────────────────────────────────────
"""

# ── MASTER KILL SWITCH ───────────────────────────────────────────────────────
DISABLE_ALL_RATE_LIMITS = False
# Set True to bypass EVERY rate limit in the entire backend at once.
# Useful when hammering the API locally or running bulk imports.


# ── PER-ENDPOINT / PER-GROUP DISABLE FLAGS ───────────────────────────────────
# Only checked when DISABLE_ALL_RATE_LIMITS = False.
# Set any of these to True to disable just that endpoint or group.

# Auth
DISABLE_RL_AUTH_ME             = False  # GET  /auth/me
DISABLE_RL_AUTH_LOGIN          = False  # POST /auth/login
DISABLE_RL_AUTH_SIGNUP         = False  # POST /auth/signup
DISABLE_RL_AUTH_REFRESH        = False  # POST /auth/refresh + /auth/logout
DISABLE_RL_AUTH_EMAIL_SEND     = False  # POST /auth/send-verification + /auth/reset-password
DISABLE_RL_AUTH_FORGOT_PASSWORD = False # POST /auth/forgot-password

# Data reads
DISABLE_RL_READ_TRANSACTIONS = False  # GET /transactions  ← the one that was killing transactions
DISABLE_RL_READ_CATEGORIES   = False  # GET /categories    ← same
DISABLE_RL_READ_CHARTS       = False  # GET /charts/*
DISABLE_RL_READ_UPLOADS      = False  # GET /uploads/count + /uploads/breakdown
DISABLE_RL_READ_ADMIN        = False  # GET admin reads (permissions, roles, users, impersonation-log)

# Preferences
DISABLE_RL_PREFERENCES_READ  = False  # GET /preferences
DISABLE_RL_PREFERENCES_WRITE = False  # PUT /preferences

# Category + admin writes
DISABLE_RL_CATEGORY_WRITE    = False  # all category writes + admin role/user/permission writes

# Categorisation pipeline
DISABLE_RL_CATEGORISE_CACHED = False  # /categorize/cached + /exact + /merchant + /similarity + /resolve
DISABLE_RL_CATEGORISE_LLM    = False  # /categorize/llm  (costs money — keep this one on)
DISABLE_RL_CATEGORISE_BATCH  = False  # /categorize/resolve-and-exit + /resolve-remaining-to-other

# Upload
DISABLE_RL_UPLOAD            = False  # POST /api/parse-csv

# Admin sensitive
DISABLE_RL_ADMIN_SENSITIVE   = False  # POST /admin/tokens/revoke
DISABLE_RL_ADMIN_UNLOCK              = False  # POST /admin/users/<id>/unlock
DISABLE_RL_ADMIN_USER_TRANSACTIONS   = False  # GET  /admin/users/<id>/transactions


# ── INTERNAL HELPER ──────────────────────────────────────────────────────────

_NO_LIMIT = "10000 per day"  # effectively unlimited; Flask-Limiter still needs a string


def _rl(limit_string: str, flag_name: str = ""):
    """Return a callable Flask-Limiter evaluates at request time (not import time).

    flag_name: name of the DISABLE_RL_* variable in this module.
    The closure reads module globals on every request, so toggling a flag
    above takes effect immediately without restarting the server.
    """
    import sys

    def _limit():
        this_module = sys.modules[__name__]
        if DISABLE_ALL_RATE_LIMITS:
            return _NO_LIMIT
        if flag_name and getattr(this_module, flag_name, False):
            return _NO_LIMIT
        return limit_string
    return _limit


# ── AUTH ─────────────────────────────────────────────────────────────────────

RL_AUTH_EMAIL_SEND = _rl("10 per hour", "DISABLE_RL_AUTH_EMAIL_SEND")
# POST /auth/send-verification + /auth/reset-password — IP-level guard on top of
# per-user daily cap enforced in auth.py. 10/hour per IP is generous for real use;
# stops a bot from hammering the endpoint before the per-user logic even fires.
# Used in: routes/auth.py

RL_AUTH_FORGOT_PASSWORD = _rl("5 per minute; 20 per hour", "DISABLE_RL_AUTH_FORGOT_PASSWORD")
# POST /auth/forgot-password — unauthenticated endpoint; per-IP only (can't key on user
# because we don't reveal whether the account exists). 5/min stops burst flooding;
# 20/hour limits sustained harassment of a target's inbox.
# Used in: routes/auth.py

RL_AUTH_ME = _rl("100 per day", "DISABLE_RL_AUTH_ME")
# GET /auth/me — identity check on load. 100/day is generous; blocks hammering
# if a token is stolen. Used in: routes/auth.py

RL_AUTH_LOGIN = _rl("10 per minute", "DISABLE_RL_AUTH_LOGIN")
# POST /auth/login — brute-force protection. 10/min is more than enough for
# any real user; stops automated credential guessing cold.
# Used in: routes/auth.py

RL_AUTH_SIGNUP = _rl("5 per minute", "DISABLE_RL_AUTH_SIGNUP")
# POST /auth/signup — you almost never retry this; mainly blocks mass account
# creation by bots. Used in: routes/auth.py

RL_AUTH_REFRESH = _rl("60 per hour", "DISABLE_RL_AUTH_REFRESH")
# POST /auth/refresh + POST /auth/logout — 60/hour = once per minute, way more
# than the app needs; just catches a runaway refresh loop.
# Used in: routes/auth.py

RL_AUTH_CHANGE_PASSWORD = _rl("10 per hour", "DISABLE_RL_AUTH_EMAIL_SEND")
# POST /auth/change-password — brute-force protection for password change.
# 10/hour per IP is generous for a legitimate user; stops credential stuffing.
# Used in: routes/auth.py

RL_AUTH_CANCEL_DELETION = _rl("10 per hour", "DISABLE_RL_AUTH_EMAIL_SEND")
# POST /auth/cancel-deletion — unauthenticated token redemption endpoint.
# 10/hour stops replay-flooding a valid token before it's marked used.
# Used in: routes/auth.py


# ── DATA READS ───────────────────────────────────────────────────────────────

RL_READ_TRANSACTIONS = _rl("200 per day", "DISABLE_RL_READ_TRANSACTIONS")
# GET /transactions — fetched on every page load and after every upload.
# 200/day is generous for normal use; set DISABLE_RL_READ_TRANSACTIONS=True
# when doing bulk testing. Used in: routes/transactions/crud.py

RL_READ_CATEGORIES = _rl("200 per day", "DISABLE_RL_READ_CATEGORIES")
# GET /categories — called on load and before any categorisation step.
# 200/day matches transactions; set DISABLE_RL_READ_CATEGORIES=True if you
# hit the limit during testing. Used in: routes/categories.py

RL_READ_CHARTS = _rl("100 per day", "DISABLE_RL_READ_CHARTS")
# GET /charts/* — loaded when the dashboard mounts. 100/day is plenty.
# Used in: routes/charts.py

RL_READ_UPLOADS = _rl("100 per day", "DISABLE_RL_READ_UPLOADS")
# GET /uploads/count + /uploads/breakdown — sidebar stats on load.
# Used in: routes/transactions/crud.py (count), routes/uploads.py (breakdown)

RL_READ_ADMIN = _rl("100 per day", "DISABLE_RL_READ_ADMIN")
# GET admin reads — permissions, roles, users list, impersonation log.
# Infrequent; 100/day is ceiling, not expected usage.
# Used in: routes/admin.py

RL_READ_STANDARD = RL_READ_ADMIN
# Backward-compat alias — some routes still import this name.
# Points to RL_READ_ADMIN; new routes should use the specific constant.


# ── PREFERENCES ──────────────────────────────────────────────────────────────

RL_READ_PREFERENCES = _rl("200 per day", "DISABLE_RL_PREFERENCES_READ")
# GET /preferences — fires on every route change in the React app, so needs
# to be higher than a once-per-session limit.
# Used in: routes/preferences.py

RL_WRITE_PREFERENCES = _rl("500 per day", "DISABLE_RL_PREFERENCES_WRITE")
# PUT /preferences — column widths, display settings. High because Vite dev
# hot-reloads can trigger this repeatedly. Used in: routes/preferences.py


# ── CATEGORY MANAGEMENT ──────────────────────────────────────────────────────

RL_CATEGORY_WRITE = _rl("20 per day", "DISABLE_RL_CATEGORY_WRITE")
# All category writes: rename, recolor, create, delete, combine, reorder,
# reset-defaults, set-default-color + PATCH /admin/roles, PATCH/DELETE
# admin users/credentials/permissions + POST/PATCH/DELETE /admin/accounts.
# Deliberate admin actions; 20/day is fine.
# Used in: routes/categories.py (all writes), routes/admin.py (all writes),
#          routes/admin_auth.py (create/edit/delete admin accounts)


# ── CATEGORISATION PIPELINE ──────────────────────────────────────────────────

RL_CATEGORISE_CACHED = _rl("100 per day", "DISABLE_RL_CATEGORISE_CACHED")
# /categorize/cached + /exact + /merchant + /similarity + /resolve.
# Run once per upload; 100/day ≈ 3–4 full uploads with retries.
# Used in: routes/transactions/categorisation_routes.py

RL_CATEGORISE_LLM = _rl("20 per day", "DISABLE_RL_CATEGORISE_LLM")
# POST /categorize/llm — Gemini call; costs real money. Keep this one on.
# 20/day is generous for one user.
# Used in: routes/transactions/categorisation_routes.py

RL_CATEGORISE_BATCH = _rl("50 per day", "DISABLE_RL_CATEGORISE_BATCH")
# /categorize/resolve-and-exit + /resolve-remaining-to-other — bulk finishers.
# Run once per manual-review session. Used in: routes/transactions/categorisation_routes.py

RL_UPLOAD = _rl("50 per day", "DISABLE_RL_UPLOAD")
# POST /api/parse-csv — 50/day ≈ uploading every 30 min all day.
# Mainly stops a stuck client hammering duplicate submissions.
# Used in: routes/transactions/upload.py


# ── ADMIN SENSITIVE ──────────────────────────────────────────────────────────

RL_ADMIN_SENSITIVE = _rl("60 per hour", "DISABLE_RL_ADMIN_SENSITIVE")
# POST /admin/tokens/revoke — token revocation. Legitimate use is rare
# (one revoke per session); this blocks automated token-cycling abuse.
# Also used for POST /admin/accounts/<id>/reset-mfa — MFA reset is a
# sensitive irreversible action; 60/hour is more than enough.
# Used in: routes/admin.py (tokens/revoke), routes/auth.py (logout),
#          routes/admin_auth.py (reset-mfa)

RL_ADMIN_UNLOCK = _rl("30 per hour", "DISABLE_RL_ADMIN_UNLOCK")
# POST /admin/users/<id>/unlock — account unlock by admin+.
# Used in: routes/admin.py (users/unlock)

RL_ADMIN_USER_TRANSACTIONS = _rl("200 per day", "DISABLE_RL_ADMIN_USER_TRANSACTIONS")
# GET /admin/users/<id>/transactions — admin view of any user's transactions.
# Used in: routes/admin.py (admin_get_user_transactions)
