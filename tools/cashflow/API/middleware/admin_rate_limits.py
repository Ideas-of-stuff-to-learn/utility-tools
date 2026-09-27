"""
middleware/admin_rate_limits.py

Rate limits for the admin panel — login, within-panel reads/writes,
sensitive actions.

User/Cashflow limits live in middleware/user_rate_limits.py.
DISABLE_ALL_RATE_LIMITS master kill-switch is read from this module
(own copy) so toggling it here kills all admin limits without touching
the user file. If you want to kill everything at once, set it True in
both files, or just use the per-endpoint flags on the specific limits
you want to bypass.
"""
from middleware.user_rate_limits import _NO_LIMIT

# ── MASTER KILL SWITCH (admin copy) ──────────────────────────────────────────
DISABLE_ALL_RATE_LIMITS = False

# ── PER-ENDPOINT DISABLE FLAGS ───────────────────────────────────────────────
DISABLE_RL_ADMIN_LOGIN               = False  # POST /admin/auth/login + /verify-totp
DISABLE_RL_ADMIN_REFRESH             = False  # POST /admin/auth/refresh
DISABLE_RL_ADMIN_ME                  = False  # GET  /admin/auth/me + account-management reads
DISABLE_RL_READ_ADMIN                = False  # GET  admin panel reads (permissions, roles, users, log)
DISABLE_RL_ADMIN_WRITE               = False  # POST/PATCH/DELETE admin panel writes (roles, users, accounts)
DISABLE_RL_ADMIN_SENSITIVE           = False  # POST /admin/tokens/revoke + /reset-mfa
DISABLE_RL_ADMIN_UNLOCK              = False  # POST /admin/users/<id>/unlock
DISABLE_RL_ADMIN_USER_TRANSACTIONS   = False  # GET  /admin/users/<id>/transactions
DISABLE_RL_GEO_HEARTBEAT             = False  # POST /admin/geo/heartbeat


# ── INTERNAL HELPER ──────────────────────────────────────────────────────────

def _rl(limit_string: str, flag_name: str = ""):
    """Return a callable Flask-Limiter evaluates at request time.
    Captures this module's __name__ so flag lookups resolve against
    THIS module's globals, not user_rate_limits."""
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


# ── ADMIN AUTH ────────────────────────────────────────────────────────────────

RL_ADMIN_LOGIN = _rl("10 per minute", "DISABLE_RL_ADMIN_LOGIN")
# POST /admin/auth/login + POST /admin/auth/verify-totp — brute-force protection.
# Used in: routes/admin_auth.py

RL_ADMIN_REFRESH = _rl("60 per hour", "DISABLE_RL_ADMIN_REFRESH")
# POST /admin/auth/refresh — catches runaway refresh loops.
# Used in: routes/admin_auth.py

RL_ADMIN_ME = _rl("100 per day", "DISABLE_RL_ADMIN_ME")
# GET /admin/auth/me + read-only account management endpoints.
# Used in: routes/admin_auth.py


# ── ADMIN PANEL READS ────────────────────────────────────────────────────────

RL_READ_ADMIN = _rl("100 per day", "DISABLE_RL_READ_ADMIN")
# GET admin reads: permissions, roles, users list, impersonation log,
# admin accounts list.
# Used in: routes/admin.py, routes/admin_auth.py


# ── ADMIN PANEL WRITES ───────────────────────────────────────────────────────

RL_ADMIN_WRITE = _rl("20 per day", "DISABLE_RL_ADMIN_WRITE")
# POST/PATCH/DELETE: role management, user management,
# admin account create/edit/delete.
# Used in: routes/admin.py, routes/admin_auth.py


# ── ADMIN SENSITIVE ──────────────────────────────────────────────────────────

RL_ADMIN_SENSITIVE = _rl("60 per hour", "DISABLE_RL_ADMIN_SENSITIVE")
# POST /admin/tokens/revoke — token revocation.
# POST /admin/accounts/<id>/reset-mfa — MFA reset (irreversible security action).
# Used in: routes/admin.py, routes/admin_auth.py

RL_ADMIN_UNLOCK = _rl("30 per hour", "DISABLE_RL_ADMIN_UNLOCK")
# POST /admin/users/<id>/unlock — account unlock.
# Used in: routes/admin.py

RL_ADMIN_USER_TRANSACTIONS = _rl("200 per day", "DISABLE_RL_ADMIN_USER_TRANSACTIONS")
# GET /admin/users/<id>/transactions — admin view of a user's transactions.
# Used in: routes/admin.py

RL_GEO_HEARTBEAT = _rl("20 per hour", "DISABLE_RL_GEO_HEARTBEAT")
# POST /admin/geo/heartbeat — periodic geo check from the admin panel frontend.
# 20/hr is far above the intended 6/hr (one per 10 min) but allows catch-up
# after the tab was backgrounded without eating into the ip-api.com 45/min budget.
# Used in: routes/admin_auth.py
