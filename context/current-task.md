<!-- last-verified: a834bca 2026-09-23 -->
# Cashflow2.0 — Current Task

## Status (2026-09-30)

Billing Phases 1–3 complete. Phase 4 (admin billing section + cron job) pending.

**Stripe env vars to add (Render + local .env):**
```
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Webhook URL for Stripe dashboard:**
`https://utility-tools-b6dj.onrender.com/billing/webhook`

**Billing Phase 4 complete.** Admin billing settings panel, IP management panel, and GitHub Actions cron workflow all done.

**Next:** `/ship-main` when ready. After that, Stripe env vars need to be added to Render before billing goes live.

## Recently Completed

**Cashflow boot overhaul (2026-09-29):**
- Root cause of the recurring return-visit cycle: `UserPreferencesContext` sent `GET /preferences` before `/auth/me`. The HMAC 401 led to a refresh with CSRF "null", then session-expired, then a bounce through landing `/login` and back.
- `api.jsx`:
  - `bootstrapSession()` plus a session gate in `authorizedFetch`.
  - Refresh deduped until complete.
  - Re-sign instead of re-refresh after a token rotation.
  - Refresh CSRF recovered via the new `GET /auth/csrf`.
  - 429/5xx are transient.
  - No `X-CSRF-TOKEN` on GETs, so `/auth/me` needs no preflight.
- `AuthContext`: `checking | authenticated | unauthenticated`, with retry/backoff and a `connectionSlow` flag. The sessionStorage hint is removed.
- `App`/`RequiresAuth`: no StartupScreen. The redirect runs in an effect, with a 20s loop breaker that shows an inline panel.
- IDB:
  - One encrypted snapshot (`idb/bootSnapshot.js`), prefetched before React renders.
  - Re-saved from state on every change and flushed before Back to Tools (`idb/persistence.js`).
  - Background revalidation via the new `GET /sync/state` fingerprint.
- Resize:
  - `UploadSessionContext` holds picked files, progress, the upload-summary popup and parked manual review.
  - Chart mode/window live in `ChartFilterContext`.
  - `ResponsiveGate` always renders `<Outlet/>`.
  - The chart CSS breakpoint is 1023px.
- Chart:
  - `useChartIdb` (PNG cache) deleted.
  - `StackChartCanvas` hook order and stale-redraw fixed.
  - `chartSummary` is a `useMemo`.
  - Category auto-select runs in a layout effect.
  - Stack order is reactive to preferences.
- Backend:
  - JSON 429 handler, CORS preflight `max_age` 7200.
  - `/auth/me` limit 30/min + 1500/day.
  - Revocation-check connection leak fixed.
- Landing: `?redirect=` allowlist (open-redirect/DOM-XSS fix), shared `/auth/me` promise, refresh parity.

**Task 25 — Encrypted IndexedDB layer (2026-09-27):**
- Envelope encryption: KEK in `IDB_MASTER_KEY` env var, per-user DEK in `user_idb_keys` table (AES-256-GCM encrypted)
- New `crypto/idb_keys.py` — get_or_create_dek(), encrypt/decrypt DEK with KEK
- `user_idb_keys` migration + blocklist on PUT /preferences for `idb_key`
- `/auth/login`, `/auth/signup`, `/auth/me` all return `idb_key` + `user_id`
- Frontend `src/idb/`: `crypto.js` (AES-256-GCM), `store.js` (per-user DB `cashflow-db-{userId}`, 6 stores, staleness API), `writeQueue.js` (optimistic drain + rollback + auto-drain on focus/online)
- `api.jsx`: imports DEK on login/signup/getMe, nulls key + flushes queue on logout (IDB blobs persist)
- `UserPreferencesContext.jsx`: IDB instant hydration → server authoritative in background; removed all localStorage
- `TransactionsContext.jsx`: IDB cache hydration + staleness check + `optimisticUpdateTransactions` helper
- `GET /categories` now returns `version` field for staleness detection
- `theme.js` + `useThemeSync.js`: kept on localStorage (non-sensitive, synchronous boot requirement)
- Shipped: (pending)

**Task 1 remaining — tools JWT claim wiring (2026-09-27):**
- routes/auth.py: login + signup issue tokens with tools=['cashflow']; refresh carries claim forward
- middleware/user_middleware.py: require_auth() now checks tools claim (strict — 403 if missing)
- All 22 bare @jwt_required() in cashflow routes → @require_auth()
- CORS audited clean (locked to github.io in prod). Blueprint isolation audited clean.
- Strict enforcement: existing logged-in users get 403 until they log in again (intentional)
- Shipped 64d141f

**Task 22 — Admin security hardening + geo-blocking (2026-09-27):**
- HMAC request signing on all admin state-changing endpoints
- CSP + security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- Rate limit middleware restructure → middleware/ folder (admin_rate_limits.py, user_rate_limits.py, admin_middleware.py, user_middleware.py)
- Geo-blocking: ADMIN_GEO_ALLOWLIST env var, country allowlist gating on login
- Impossible travel detection: haversine + exponential strike lockout (15→30→60→120→240 min, permanent at 5 strikes), cached-fallback on ip-api.com failure
- geo_lookup_log table + GET /admin/geo-logs endpoint (level-gated)
- Geo Logs admin tab (dual-thumb date range slider, scrollable table, 90-day default)
- Geo heartbeat POST /admin/geo/heartbeat every 10 min + on page focus
- Stale .pyc cleared (RL_ADMIN_SENSITIVE NameError in routes/auth.py)

**admin.accounts.manage permission gate (2026-09-27):**
- Sidebar.jsx: Admin Accounts NavLink hidden unless owner or has admin.accounts.manage
- admin_auth.py: all 3 /admin/accounts endpoints now gated by admin.accounts.manage (replacing users.view / users.create / users.delete)
- permission_weights.py + permissionWeights.js: admin.accounts.manage weight = 33
- schema.sql: INSERT admin.accounts.manage permission + admin_audit_log table + audit log endpoint

## Recently Completed

**Level-ceiling enforcement + email CC matrix (2026-09-24):**
- Hard level-ceiling on all manipulation endpoints with no owner exemption
- Email CC matrix: admin panel deletions (scheduled/cancelled/permanent) To: actor CC: owner
- `pending_deletion_by_email` stored at schedule time; cancel emails added
- `PROTECTED_ROLE_NAMES` removed (redundant)
- Fixed `_get_owner_email` wrong join table
- UI: RolesScreen and UsersScreen hide actions for equal/above level

## Recently Completed

**Task 1 — Email migration (2026-09-23):**
- DB: added email, email_verified, display_name, oauth_provider, oauth_sub, stripe_customer_id, subscription_status columns; password_hash made nullable; display_name backfilled from username
- Backend `auth.py`: get_user_by_email, email_exists, validate_email helpers; /auth/login routes by @ presence; /auth/signup accepts optional email; /auth/me returns email + display_name; create_user stores email + sets display_name
- Frontend `api.jsx`: login() routes email/username by @; signup() accepts optional email
- Frontend `LoginScreen.jsx`: "Username" → "Email or username" field
- Frontend `SignupScreen.jsx`: optional Email field added between username and password
- Existing username-only accounts fully unaffected — email column nullable, fallback preserved

## Recently Completed

**Responsive modal / popup audit + dashboard chart spacing (2026-09-20):**
- Full audit of all 17 CSS files + 44 JSX components for clipping / overflow on small viewports
- `manualReviewModal.css` — `.mr-card`: `overflow: hidden` → `overflow-y: auto` + `max-height: 90vh` so category picker scrolls instead of clipping
- `dashboardStyles.css` — `.dashboard-chart-area`: `padding-top: 12px` added so chart title has breathing room at top
- `contentsStyles.css` — `.modal-card`: `overflow: hidden` → `overflow-y: auto`, `max-height: 70%` → `70vh`; `.modal-list`: `flex: 1; min-height: 0` promoted to base rule (was narrow-only) so category list scrolls on desktop
- Surfaces confirmed fine: segment popup, upload popup, stats modal, all narrow cards
- 2 commits shipped: `46beece`, `a37dda1`

**Rate limiting overhaul — granular controls + theme/UI polish (2026-09-20):**
- `App/API/rate_limits.py` — per-endpoint disable flags (`DISABLE_RL_READ_TRANSACTIONS`, `DISABLE_RL_READ_CATEGORIES`, etc.) + master kill switch `DISABLE_ALL_RATE_LIMITS`; all constants are callables so flags take effect at request time without restart
- GET /transactions and GET /categories re-wired into rate_limits.py (were commented out); now individually disableable via flags
- All route files updated to use specific constants (RL_READ_TRANSACTIONS, RL_READ_CATEGORIES, RL_READ_CHARTS, RL_READ_UPLOADS, RL_READ_ADMIN) instead of catch-all RL_READ_STANDARD
- Secondary action buttons (btn-secondary, logout-btn) changed from hardcoded green/red to `var(--primary-light)` / `var(--primary)` themed fill
- Chart colour theme system: per-theme 14-colour palettes in `App/WebUI/src/styles/themes/chartColors.js`; `useThemeSync` hook auto-pushes palette to server on page load when CSS `--theme-name` differs from `localStorage('appliedChartTheme')` — no manual button
- Dashboard page scroll fixed: `.app-shell-locked` uses `height: 100%; min-height: 0` (not 100vh) to fit within `#root` which is `height: 100%; padding-top: 10px; box-sizing: border-box`

## Recently Completed

**App title, header layout, filter pane, mobile polish (2026-09-20):**
- `appTitle.js` — single source of truth for app title; all three occurrences updated to import from it
- Dashboard header title: ResizeObserver steps font from CSS base down to 9px floor to prevent wrapping
- Mobile home title: same ResizeObserver, base 24px, floor 10px
- Header changed from 3-column CSS grid to flex with explicit left/center/right wrappers; center always midway between title edge and badge edge; min-width: 80px on right reserves badge space even when RoleBadge returns null
- Mobile pills (User Information / Data Security) now hidden on `/charts`, shown on `/home`
- Filter pane: header divider removed, all spacing tightened, base font 13→14px
- User Information popup: max-height + invisible scroll + sticky close button for mobile
- Tasks 19 and 20 marked done in backlog.md

## Recently Completed

**Manual review UX + stats fixes (2026-09-17):**
- `ManualReviewStatsModal.jsx`: percentage now shows exact decimal (e.g. `0.40%`) instead of rounding to `0%` when count is non-zero; ≥1% rounds to whole number
- `ManualReviewGate.jsx`: optimistic exit — local state updates immediately, server fires in background; race pattern: if server responds within 400ms modal closes instantly, if slower shows spinner as fallback, if both retries fail shows error screen
- `ManualReviewGate.jsx`: `flushPendingResolutions` (all items done) — "All done!" shows immediately, server syncs in background, modal closes after 900ms
- `ManualReviewSequentialModal.jsx`: saving/done card restyled — small centered card, spinner animation while saving, checkmark for all-done; full flushing/exitFailed framework preserved
- `categorisation_routes.py`: new `/categorize/resolve-and-exit` endpoint — saves picks + bulk-resolves remaining to Other in one DB transaction (replaces two sequential round trips)
- `api.jsx`: `resolveAndExit()` frontend function

**FilterPane order/persist bug fixes (2026-09-17):**
- `useStackOrder.jsx`: hydration effect no longer filters `savedOrder` against `categoryNames` at mount (categoryNames=[] on mount → filtering produced [] permanently, breaking all filter checkboxes on reload). Now sets raw `savedOrder` directly; `effectiveOrder` already filters reactively on every render.
- `FilterPane.jsx`: "Remember this order" and "Reset to default" both now gated on `isCustomOrder`. Previously "Remember this order" was always visible and clickable even on default order.

## Recently Completed

**UserPreferences context + column resize persistence + info popup + delete removal + virtualizer fix (2026-09-16):**
- New `UserPreferencesContext` (5th context, between Auth and Processing)
- Column widths, stack order, MR picks — localStorage → React context → debounced server PUT (2s) + beforeunload keepalive flush
- Single `serverGet()` on login; server authoritative over localStorage
- New backend `App/API/routes/preferences.py` with JSONB partial merge; `preferences JSONB` column on users table
- TableHeader drag-end saves to context + server; applied from context on mount
- Delete button removed from SelectionBar
- ℹ info popup added to Transactions header in Layout.jsx
- Desktop ContentsScreen sidebar scrollbar hidden
- CSS media query synced from 700px → 1023px to match JS `isMobile` breakpoint (1024px)
- `.cs-container` height fixed: `calc(100vh - 48px)` instead of broken `height: 100%` chain — was rendering all 3700+ rows every mount, now virtualizer works correctly and navigation is instant

**Previously (2026-09-15):**

**Persistent Repository Intelligence System (full coverage):**
- `CLAUDE.md` — entry point pointing to `.ai/knowledge.db` and context docs
- `context/architecture.md` — full layer diagram, 4-context AppState split, both sentinels, ResponsiveGate routing, ChartsScreen/HomeScreen roles, RN vs web differences
- `context/constraints.md` — both sentinels in 4 files, RoleBadge position, ResponsiveGate ownership, popup config warning, 4-context invariant
- `context/known-problems.md` — sentinel quadruplication, COLOR_PALETTE triplication, RN popup not wired, no tests
- `context/dependencies.md` — inter-file relationships, context composition chain, sentinel duplication map, routing chain
- `context/decisions.md` — engineering decisions with rationale
- `context/failed-solutions.md` — 10 failed approaches with lessons
- `context/realignment.md` — recovery procedure, never-do list
- `context/handoff.md` — session state
- `context/overview.md` — project purpose and tech stack
- `.ai/rebuild_db.py` — generates SQLite index of all ~150 source files across WebUI, NativeAppUI, API, and shared

**ContentsScreen redesign (2026-09-15):**
- Sidebar layout for ContentsScreen
- Layout.jsx 3-column grid header
- Owner badge always top-right

## Open Work (Not Blocking)

- RN popup wiring: popupChartConfig.js vocabulary exists but ChartWindowSection.js has hardcoded popup
- FilterPane RN drag animation (cosmetic)
- COLOR_PALETTE triplication (adminClI/web/RN can drift)
- Root README.md placeholder

## Next Session Guidance

Start with realignment.md → overview.md → architecture.md. Key non-obvious things to know:
1. Web AppState = 4 separate contexts (not one) — `appState/index.jsx` composes them
2. Two sentinels, not one: NEEDS_MANUAL_REVIEW (user picks) + NOT_YET_CATEGORISED (retry, hidden from user)
3. ResponsiveGate: mobile→/home+/charts, desktop→/dashboard — re-evaluates live on resize
4. ChartsScreen.jsx at /charts is the "phone mimic" for mobile-width web users
5. RN uses single AppContext.js (useApp hook) — not split like web
6. RN popup is hardcoded — popupChartConfig.js has no effect there
