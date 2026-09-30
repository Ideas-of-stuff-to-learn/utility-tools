-- Client-side failure log (2026-09-30)
-- The web app reports failed network calls, timeouts, and boot fallbacks
-- (e.g. the local cache stalled and the dashboard loaded from the network).
-- Written by POST /client-events (any signed-in user, batched, rate limited),
-- read-only in the admin panel under General > Failed network calls.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS client_events (
    id           BIGSERIAL PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- when the server stored it
    occurred_at  TIMESTAMPTZ,                          -- when the client says it happened
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,   -- network_error | timeout | http_error | slow_response | boot_fallback | idb_timeout | queue_dropped
    method       TEXT,
    path         TEXT,            -- path only, query string stripped
    status       INTEGER,
    duration_ms  INTEGER,
    message      TEXT,
    page         TEXT,
    detail       JSONB
);
CREATE INDEX IF NOT EXISTS idx_client_events_created_at ON client_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_events_kind       ON client_events (kind, created_at DESC);
