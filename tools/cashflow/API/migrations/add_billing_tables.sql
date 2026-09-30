-- migrations/add_billing_tables.sql
--
-- Phase 1 billing tables. Run once in Supabase SQL editor.
-- Safe to re-run (all statements use IF NOT EXISTS / DO NOTHING).
--
-- Tables:
--   billing_settings       — runtime-tunable key/value pairs (admin-editable)
--   user_subscriptions     — one row per user, tracks tier + Stripe state
--   user_tool_trials       — one row per (user, tool), tracks trial window
--   user_access_grants     — manual grants from admin (override tier)
--   ip_unlock_log          — audit trail for IP ban/lock events

-- ── billing_settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Seed default runtime values (idempotent)
INSERT INTO billing_settings (key, value, description) VALUES
    ('trial_length_days',       '30',   'Default free trial length in days'),
    ('upload_cap_base',         '3',    'Max uploads allowed on base tier (no active trial/sub)'),
    ('first_n_users_exempt',    '50',   'First N users by id skip the card-required check'),
    ('trial_warning_day',       '28',   'Day N of trial to send the trial-ending warning email'),
    ('stripe_price_id_pro_monthly', '', 'Stripe Price ID for pro monthly plan (set after Stripe setup)'),
    ('stripe_price_id_pro_yearly',  '', 'Stripe Price ID for pro yearly plan (set after Stripe setup)')
ON CONFLICT (key) DO NOTHING;

-- ── user_subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_subscriptions (
    user_id                 INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier                    TEXT    NOT NULL DEFAULT 'base',  -- 'base' | 'pro'
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT,
    stripe_status           TEXT,    -- active | past_due | canceled | trialing | etc.
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN  NOT NULL DEFAULT FALSE,
    payment_failed_at       TIMESTAMPTZ,
    card_last4              TEXT,
    card_brand              TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_customer
    ON user_subscriptions(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_stripe_subscription
    ON user_subscriptions(stripe_subscription_id)
    WHERE stripe_subscription_id IS NOT NULL;

-- ── user_tool_trials ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_tool_trials (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool        TEXT    NOT NULL,   -- e.g. 'cashflow'
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    ends_at     TIMESTAMPTZ NOT NULL,
    ended_early BOOLEAN     NOT NULL DEFAULT FALSE,  -- true if user cancelled
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, tool, started_at)
);

CREATE INDEX IF NOT EXISTS idx_user_tool_trials_user_tool
    ON user_tool_trials(user_id, tool);

-- ── user_access_grants ───────────────────────────────────────────────────────
-- Manual admin overrides: grant or revoke tool access outside the normal tier.
CREATE TABLE IF NOT EXISTS user_access_grants (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool        TEXT    NOT NULL,
    granted     BOOLEAN NOT NULL DEFAULT TRUE,
    reason      TEXT,
    granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expires_at  TIMESTAMPTZ,   -- NULL = permanent
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, tool)
);

-- ── ip_unlock_log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ip_unlock_log (
    id              SERIAL PRIMARY KEY,
    ip_address      TEXT NOT NULL,
    action          TEXT NOT NULL,   -- 'lock' | 'unlock' | 'ban' | 'unban'
    reason          TEXT,
    performed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    performed_at    TIMESTAMPTZ DEFAULT NOW(),
    metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_ip_unlock_log_ip
    ON ip_unlock_log(ip_address);

CREATE INDEX IF NOT EXISTS idx_ip_unlock_log_performed_at
    ON ip_unlock_log(performed_at DESC);
