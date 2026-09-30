"""
middleware/user_rate_limits.py

Single source of truth for every rate limit on Cashflow + landing routes
(regular user auth, data reads, categorisation, uploads).

Admin-specific limits live in middleware/admin_rate_limits.py.

─────────────────────────────────────────────────────────────────────────────
DISABLE SWITCHES  (set True to bypass — testing / debugging only)
─────────────────────────────────────────────────────────────────────────────
  DISABLE_ALL_RATE_LIMITS          → kills every limit across the entire
                                     backend (both user and admin files read
                                     this flag from this module).

  Per-endpoint flags below are only checked when DISABLE_ALL=False.
─────────────────────────────────────────────────────────────────────────────
"""

# ── MASTER KILL SWITCH ───────────────────────────────────────────────────────
DISABLE_ALL_RATE_LIMITS = False

# ── PER-ENDPOINT DISABLE FLAGS ───────────────────────────────────────────────

# Auth
DISABLE_RL_AUTH_ME              = False  # GET  /auth/me
DISABLE_RL_AUTH_LOGIN           = False  # POST /auth/login
DISABLE_RL_AUTH_SIGNUP          = False  # POST /auth/signup
DISABLE_RL_AUTH_REFRESH         = False  # POST /auth/refresh
DISABLE_RL_AUTH_LOGOUT          = False  # POST /auth/logout
DISABLE_RL_AUTH_EMAIL_SEND      = False  # POST /auth/send-verification + /auth/reset-password
DISABLE_RL_AUTH_FORGOT_PASSWORD = False  # POST /auth/forgot-password
DISABLE_RL_AUTH_CHANGE_PASSWORD = False  # POST /auth/change-password
DISABLE_RL_AUTH_CANCEL_DELETION = False  # POST /auth/cancel-deletion

# Data reads
DISABLE_RL_READ_TRANSACTIONS = False  # GET /transactions
DISABLE_RL_READ_CATEGORIES   = False  # GET /categories
DISABLE_RL_READ_CHARTS       = False  # GET /charts/*
DISABLE_RL_READ_UPLOADS      = False  # GET /uploads/count + /uploads/breakdown
DISABLE_RL_SYNC_STATE        = False  # GET /sync/state

# Preferences
DISABLE_RL_PREFERENCES_READ  = False  # GET /preferences
DISABLE_RL_PREFERENCES_WRITE = False  # PUT /preferences

# Client diagnostics
DISABLE_RL_CLIENT_EVENTS     = False  # POST /client-events

# Category writes
DISABLE_RL_CATEGORY_WRITE    = False  # all category writes

# Categorisation pipeline
DISABLE_RL_CATEGORISE_CACHED = False  # /categorize/cached + /exact + /merchant + /similarity
DISABLE_RL_CATEGORISE_LLM    = False  # /categorize/llm  (costs money — keep this one on)
DISABLE_RL_CATEGORISE_BATCH  = False  # /categorize/resolve-and-exit + /resolve-remaining-to-other

# Upload
DISABLE_RL_UPLOAD            = False  # POST /api/parse-csv


# ── INTERNAL HELPER ──────────────────────────────────────────────────────────

_NO_LIMIT = "10000 per day"


def _rl(limit_string: str, flag_name: str = ""):
    """Return a callable Flask-Limiter evaluates at request time.
    Captures this module's __name__ so flag lookups always resolve
    against THIS module's globals, not a caller's."""
    import sys
    _mod = __name__

    def _limit():
        this_module = sys.modules[_mod]
        if DISABLE_ALL_RATE_LIMITS:
            return _NO_LIMIT
        if flag_name and getattr(this_module, flag_name, False):
            return _NO_LIMIT
        return limit_string
    return _limit


# ── AUTH ─────────────────────────────────────────────────────────────────────

RL_AUTH_ME = _rl("30 per minute; 1500 per day", "DISABLE_RL_AUTH_ME")
# GET /auth/me — identity check on EVERY page load (cashflow, landing,
# admin) and the only source of the IDB key. The old flat 100/day per IP
# was exhausted by ordinary back-and-forth navigation, after which the app
# could not load at all for the rest of the day. The per-minute cap still
# stops a runaway loop within seconds.
# Used in: routes/auth.py

RL_AUTH_LOGIN = _rl("10 per minute", "DISABLE_RL_AUTH_LOGIN")
# POST /auth/login — brute-force protection.
# Used in: routes/auth.py

RL_AUTH_SIGNUP = _rl("5 per minute", "DISABLE_RL_AUTH_SIGNUP")
# POST /auth/signup — blocks mass account creation by bots.
# Used in: routes/auth.py

RL_AUTH_REFRESH = _rl("60 per hour", "DISABLE_RL_AUTH_REFRESH")
# POST /auth/refresh — catches a runaway refresh loop.
# Used in: routes/auth.py

RL_AUTH_LOGOUT = _rl("60 per hour", "DISABLE_RL_AUTH_LOGOUT")
# POST /auth/logout — token revocation for regular users.
# Used in: routes/auth.py

RL_AUTH_EMAIL_SEND = _rl("10 per hour", "DISABLE_RL_AUTH_EMAIL_SEND")
# POST /auth/send-verification + /auth/reset-password
# Used in: routes/auth.py

RL_AUTH_FORGOT_PASSWORD = _rl("5 per minute; 20 per hour", "DISABLE_RL_AUTH_FORGOT_PASSWORD")
# POST /auth/forgot-password — unauthenticated; per-IP only.
# Used in: routes/auth.py

RL_AUTH_CHANGE_PASSWORD = _rl("10 per hour", "DISABLE_RL_AUTH_CHANGE_PASSWORD")
# POST /auth/change-password
# Used in: routes/auth.py

RL_AUTH_CANCEL_DELETION = _rl("10 per hour", "DISABLE_RL_AUTH_CANCEL_DELETION")
# POST /auth/cancel-deletion
# Used in: routes/auth.py


# ── DATA READS ───────────────────────────────────────────────────────────────

RL_READ_TRANSACTIONS = _rl("200 per day", "DISABLE_RL_READ_TRANSACTIONS")
# GET /transactions. Used in: routes/transactions/crud.py

RL_READ_CATEGORIES = _rl("200 per day", "DISABLE_RL_READ_CATEGORIES")
# GET /categories. Used in: routes/categories.py

RL_READ_CHARTS = _rl("100 per day", "DISABLE_RL_READ_CHARTS")
# GET /charts/*. Used in: routes/charts.py

RL_READ_UPLOADS = _rl("100 per day", "DISABLE_RL_READ_UPLOADS")
# GET /uploads/count + /uploads/breakdown. Used in: routes/uploads.py, routes/transactions/crud.py

RL_SYNC_STATE = _rl("30 per minute; 2000 per day", "DISABLE_RL_SYNC_STATE")
# GET /sync/state — cheap change fingerprint the web client polls in the
# background (boot, tab focus, every 5 min). Used in: routes/sync.py

RL_READ_STANDARD = RL_READ_TRANSACTIONS
# Backward-compat alias. New routes should use a specific constant.


# ── PREFERENCES ──────────────────────────────────────────────────────────────

RL_READ_PREFERENCES = _rl("200 per day", "DISABLE_RL_PREFERENCES_READ")
# GET /preferences. Used in: routes/preferences.py

RL_WRITE_PREFERENCES = _rl("500 per day", "DISABLE_RL_PREFERENCES_WRITE")
# PUT /preferences. Used in: routes/preferences.py


# ── CLIENT DIAGNOSTICS ───────────────────────────────────────────────────────

RL_CLIENT_EVENTS = _rl("20 per minute; 300 per day", "DISABLE_RL_CLIENT_EVENTS")
# POST /client-events — batched failure reports from the web app (up to 25
# events each). The client sends at most one batch every few seconds; the cap
# stops a misbehaving client from flooding the table.
# Used in: routes/client_events.py


# ── CATEGORY WRITES ──────────────────────────────────────────────────────────

RL_CATEGORY_WRITE = _rl("20 per day", "DISABLE_RL_CATEGORY_WRITE")
# All category writes: rename, recolor, create, delete, combine, reorder,
# reset-defaults, set-default-color.
# Used in: routes/categories.py


# ── CATEGORISATION PIPELINE ──────────────────────────────────────────────────

RL_CATEGORISE_CACHED = _rl("100 per day", "DISABLE_RL_CATEGORISE_CACHED")
# /categorize/cached + /exact + /merchant + /similarity + /resolve.
# Used in: routes/transactions/categorisation_routes.py

RL_CATEGORISE_LLM = _rl("20 per day", "DISABLE_RL_CATEGORISE_LLM")
# POST /categorize/llm — Gemini call; costs real money. Keep this on.
# Used in: routes/transactions/categorisation_routes.py

RL_CATEGORISE_BATCH = _rl("50 per day", "DISABLE_RL_CATEGORISE_BATCH")
# /categorize/resolve-and-exit + /resolve-remaining-to-other.
# Used in: routes/transactions/categorisation_routes.py


# ── UPLOAD ───────────────────────────────────────────────────────────────────

RL_UPLOAD = _rl("50 per day", "DISABLE_RL_UPLOAD")
# POST /api/parse-csv. Used in: routes/transactions/upload.py
