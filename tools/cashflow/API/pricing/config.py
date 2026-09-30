"""
pricing/config.py

Structural, immutable billing settings. These are code-level decisions
that require a deploy to change. Runtime-tunable values (trial length,
upload cap N, per-user grants) live in the billing_settings DB table
and are editable from the admin panel.

NEVER put Stripe keys here — they live in .env.
"""

# ── Tier definitions ─────────────────────────────────────────────────────────
# Tier names are the source of truth. Don't rename without a migration.

TIERS = {
    'base': {
        'display_name': 'Base',
        'tools': [],           # no tool access by default
        'persistent_data': False,
        'description': 'Free account — no tool access until a trial or pro subscription starts.',
    },
    'pro': {
        'display_name': 'Pro',
        'tools': ['cashflow'],
        'persistent_data': True,
        'description': 'Full access to all tools.',
    },
}

# ── Card requirement ──────────────────────────────────────────────────────────
# Structural toggle: whether new users must enter a card to start a free trial.
# This is a deploy-level decision (not admin-panel-tunable) because it changes
# the entire signup/trial flow, not just a number.
TRIAL_REQUIRES_CARD = True

# ── Per-tool trial config ─────────────────────────────────────────────────────
# Which tools have free trials. Lengths are defaults; admin panel can override
# the runtime values via billing_settings table.
TRIAL_TOOLS = ['cashflow']

# Cooldown (seconds) before the same account can start another trial of the
# same tool. 6 months = 15_897_600 s. Immutable — changing this is a policy
# decision that must be reviewed.
TRIAL_COOLDOWN_SECONDS = 15_897_600  # 6 months

# ── Special N-users exemption ────────────────────────────────────────────────
# First N users (by user.id) skip the card-required check even if
# TRIAL_REQUIRES_CARD is True. The actual N value is runtime-tunable
# (billing_settings: 'first_n_users_exempt'). This flag enables the feature.
FIRST_N_USERS_EXEMPT_ENABLED = True

# ── Stripe price ID schema ────────────────────────────────────────────────────
# Price IDs are stored in billing_settings so they can be updated when
# Stripe prices change, without a deploy. This dict defines the expected
# keys; the admin panel reads/writes them.
STRIPE_PRICE_KEYS = [
    'stripe_price_id_pro_monthly',
    'stripe_price_id_pro_yearly',
]
