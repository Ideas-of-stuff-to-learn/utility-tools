## 2026-09-30 — Billing Phase 3 complete

**Done:**
- Cashflow `ProfilePopup.jsx`: billing section (tier badge, trial countdown, upgrade CTA) via `useBilling()`
- Landing `ProfilePopup.jsx`: billing section reading `userRole.billing` directly; upgrade links to cashflow root
- Both `ProfilePopup.css`: added billing section styles
- `Layout.jsx`: `<TrialBanner />` wired above `<Outlet />`
- Landing footer: "Plans & Pricing" link → cashflow root

**Next:** Phase 4 — admin billing section, IP management, Render Cron Job setup

---

## Pre-Compact Snapshot — 2026-09-30 19:28

**Git HEAD:** `1916c8a`
**Files touched:** context/handoff.md, context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-30 18:51

**Git HEAD:** `c809ba6`
**Files touched:** context/session-snapshot.md, context/handoff.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-30 16:26

**Git HEAD:** `50c3261`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-30 15:08

**Git HEAD:** `cfd527a`
**Files touched:** tools/cashflow/API/routes/admin.py, tools/cashflow/WebUI/src/customHooks/charts/useStackOrder.jsx, context/revert-state.md, context/known-problems.md, tools/cashflow/API/routes/categories.py...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## 2026-09-30 — Stale-build guard (all three sites detect a newer deploy and refresh)

`shared/vite-stale-build-guard.js` is a build-only Vite plugin used by `landing`, `admin` and `tools/cashflow/WebUI` (imported in each `vite.config.js`; `shared/**` added to the three `deploy-*.yml` path filters). It (1) stamps the build with the commit sha (`GITHUB_SHA`, else `git rev-parse`, else a timestamp) and emits `version.json` next to the site (`/utility-tools/version.json`, `/utility-tools/cashflow/version.json`, `/utility-tools/admin/version.json`), and (2) injects an inline ES5 script into every page's `<head>` that fetches `version.json?t=<now>` (`no-store`) ~3 s after load, when the tab is shown again, on focus / online / bfcache restore, and every 10 min while visible. Newer build: if the tab is HIDDEN and safe, flush then `location.reload()`; otherwise show a "New version available - Reload" pill (dismissible). "Safe" = no app guard vetoes (`window.__versionGuards`, cashflow: unsent write-queue entries, upload/categorising/manual review in progress via `TransactionsContext`) and no non-empty text input/textarea/selected file on the page. Loop guard: `sessionStorage['vc:reloaded-for']` means a page never auto-reloads twice for the same build (a stale CDN copy gets the pill instead). Broken assets: a `<script>`/`<link>` under `/assets/` that fails to load, or `vite:preloadError` (lazy route chunk gone after a deploy), triggers ONE reload per 60 s instead of a blank screen. Cashflow hooks: `idb/reloadGuard.js` (`addReloadGuard`), `window.__versionFlush` = `flushAll(1500)` (in `idb/persistence.js`), guard in `writeQueue.js` and `TransactionsContext.jsx`.

**What "clear and rehydrate" means here:** the code/HTML side is replaced by the reload. Cached DATA is protected separately: the boot snapshot carries a version (`SNAPSHOT_VERSION` in `idb/bootSnapshot.js`) and an older one is ignored and rebuilt from the network, and `/sync/state` fingerprints refetch anything the server changed. **When you change the shape of anything stored in IndexedDB (snapshot fields, preferences format), bump `SNAPSHOT_VERSION`** (or `DB_VERSION` for a schema change). The unsent-writes queue (`pending_ops`) is deliberately never cleared.

**Tested:** real browser (admin build served with `vite preview`): same build = no action; newer `version.json` = reload once, then pill (loop guard) when the HTML is stale; typed text vetoes; an app guard vetoes; all clear = flush ran, then reload; full rebuild as a new build + click Reload = running build changes, pill gone, guard key cleared; deleted main JS asset = exactly one reload (nav type `reload`), no loop. Cashflow guards 7/7 in node. All three sites build with `version.json` + the injected script. NOT tested on the live sites (first real proof is the next deploy after this one).

**Limits:** pages already open on builds from before this shipped have no guard, so each tab needs one manual refresh to pick it up. Auto-reload only happens while the tab is hidden; a visible tab always gets the pill. `tools/palette-mapper.html` (single static file) is not covered. Deploys are ~1-10 min behind a push (Pages cache), so the pill can appear slightly after a push.

---

## 2026-09-30 — Durable write queue, failed-call log, admin "Failed Network Calls" tab

**What:** (1) `idb/writeQueue.js` rewritten as a durable, coalescing queue (`enqueue(type, payload)`, `registerHandler(type,{run,merge,delayMs})`, `drain({force,keepalive})`, `getPending`, `whenLoaded`, `resetQueue`). Rows are AES-GCM encrypted into the new `pending_ops` store with opaque random ids (IDB `DB_VERSION` 2; old `write_queue` store left unused). Preference saves go through it (`prefs.patch`, 2 s debounce, merged); hydrate re-applies any unsent patch on top of the server copy (fixes the kill-inside-2 s caveat and the older "server overwrites a fresh local edit" race). Logout only calls `resetQueue()` (memory) — encrypted rows stay on disk and replay after the next sign-in; `api.logout()` first gives the queue a 1.5 s flush. (2) `diagnostics.js` (`reportEvent`, no imports) is fed by `authorizedFetch` (network_error, timeout, http_error for 5xx/429/403/408, slow_response >10 s), `bootSnapshot` (boot_fallback), `store.js` (idb_timeout) and the queue (queue_dropped). Events are de-duplicated (30 s), stripped of query strings/URLs, buffered until sign-in, and delivered in batches through the same queue (`client.events`, 5 s debounce) to `POST /client-events`. (3) Backend `routes/client_events.py`: `POST /client-events` (signed-in, ≤25 events, sanitised, 20/min 300/day, user id from the JWT, opportunistic prune >30 days or >50k rows) and `GET /admin/client-events` (`require_admin_auth()` with no permission = any admin; read-only, no write route exists; filters hours/kind/user_id/limit/offset plus per-kind counts). Table `client_events` in `schema.sql` + `migrations/add_client_events.sql`. Both routes degrade quietly if the table does not exist yet. (4) Admin app: sidebar "Failed Network Calls" → `/general/failed-calls` (`ClientEventsScreen.jsx`), visible to every admin. (5) Boot snapshot timeout 2.5 s → 1 s.

**ACTION FOR OWNER:** run `tools/cashflow/API/migrations/add_client_events.sql` in the Supabase SQL editor (until then nothing is stored and the admin tab says setup is needed).

**Tested:** backend 32/32 on a throwaway Postgres 17 (real routes, admin + user tokens, sanitising, filters, read-only 405s, prune, missing-table path); queue + diagnostics 24/24 on a fake IDB; 16/16 in real Chromium against real IndexedDB (v1→v2 upgrade keeps old data, durability + replay after a simulated kill, opaque ciphertext rows, and the original stall reproduced with a never-finishing transaction: reads give up at 4.0 s, boot at 1.0 s, both reported, queue still delivers); admin screen rendered against a fake API (filter, load more, GET only, no editable inputs); web + admin builds pass. NOT tested: the logged-in flow on production (both browsers report the tab hidden and there are no credentials), and the admin tab against the real backend.

**Watch after deploy:** old cashflow tabs left open on the previous build have no versionchange handler and can block the v2 upgrade until closed (the new code then just runs without local caching for that load); the `pending_ops` upgrade happens once per profile; admin reads share the 100/day `RL_READ_ADMIN` limit; log volume (a cold start can produce several events per user).

---

## 2026-09-30 — IndexedDB layer can no longer hang (store.js hardening)

Audit found no app code that holds a transaction open (all are single-request, no awaits inside), and the owner's DB was tiny (~0.5 MB) with no Chrome LOG errors, so the stall was most likely a lock leaked by a frozen renderer. Made the layer robust anyway in `idb/store.js`: `_openDB` times out at 5 s, never caches a failed/timed-out open, closes and evicts on `versionchange`/`close` (a future DB_VERSION bump would previously have blocked forever); every transaction goes through `_run` with a 4 s timeout and settles on complete/error/abort; `clearAll` closes its own connection before `deleteDatabase`. Timed-out ops return null/false exactly as the old catch paths did. `writeQueue.enqueue` no longer awaits the IDB backup put. CORRECTION: `enqueue`/`flush`/`drain` are never called anywhere (dead code; only `initQueue`/`clearQueue` are used) and nothing reads the `write_queue` store back, so this change has no runtime effect today. Real edits do not use it: preference edits go to the server on a 2 s debounce with a keepalive flush on pagehide/visibilitychange and before hard navigations (`persistence.flushAll`, capped at 1.5 s), and category/transaction edits are awaited API calls. Also: `UserPreferencesContext.hydrate` now starts the server GET in parallel with the local IDB reads, so a stalled IDB cannot delay authoritative prefs (previously they waited on the IDB reads first). Hypothesis for the original stall (unproven): a readwrite snapshot save (`replaceStoreWithRecord`, scope transactions/categories/upload_stats/_meta) whose blob write never finished because that renderer froze; reads of the `preferences` store were unaffected, which fits a lock scoped to `transactions`. Tested with a fake IDB (stalled tx, stalled open then recovery, versionchange, healthy round trip) and a clean build. `clearAll` is still not called anywhere (logout only clears the write queue): unchanged, noted.

---

## 2026-09-30 — Boot snapshot read has a 2.5 s timeout

`idb/bootSnapshot.js` `loadBootSnapshot` now races the IndexedDB read + decrypt against 2.5 s. If IDB stalls (a lock left by another tab or a frozen renderer on `cashflow-db-<id>`), it returns null and the dashboard loads from the network instead of showing "Loading your charts…" forever. Found in the owner's Chrome profile: opening the DB worked but a plain read never completed, while a fresh DB was instant. Tested with a fake IDB (healthy read 3 ms, stalled read null at 2.5 s) and a clean build. To confirm on prod: the same stuck profile should now draw the chart ~2.5 s later than normal.

---

## 2026-09-30 — Race-safe Pages deploys: 3 separate workflows + deploy-all (committed, NOT pushed)

The three Pages workflows raced: one push queued three runs in one concurrency group, and GitHub keeps only one pending run, so one was cancelled. New layout in `.github/workflows/`:
- `_publish-site.yml` (reusable): build one site, then publish to its own gh-pages folder with a fetch, re-apply and push retry loop (8 attempts). Same-site runs serialised via `publish-<site>`.
- `deploy-landing.yml`, `deploy-cashflow.yml`, `deploy-admin.yml`: thin callers, each watching only its own folder, each with a manual button.
- `deploy-all.yml`: runs the three in parallel, manually or when `backend-url.json` changes.

Verified: YAML valid for all seven workflows; the publish script was extracted from the YAML and run three at once against a local bare repo (real push collisions retried, all sites landed, unrelated files and `.nojekyll` kept). Not verified: the actual GitHub run, and the "nothing new to publish" exit.

Pushing this commit triggers `deploy-all.yml` (it edits `backend-url.json`). After that run, the sites call the Frankfurt backend; then: hard refresh, sign in once, and ask me to re-run the timing test.

---

## 2026-09-30 — (superseded) Deploy workflows now trigger on backend-url.json

`b5ee3d4` (URL switch) fired no workflows: they only watch their own folders. Added `backend-url.json` and the workflow file itself to the `paths` of the cashflow, landing and admin deploys. Pushing this commit triggers all three. Until then, the manual "Run workflow" button works.

---

## 2026-09-30 — Rename hardening: preferences follow category changes

New `API/category_prefs.py` (`transform_stack_order`, `transform_mr_picks`, `apply_to_preferences`). Called in the same transaction by rename and combine in `routes/categories.py`, and by the hard-delete job in `routes/admin.py`. `useStackOrder.jsx` now appends categories missing from a saved order. Owner had already run the SQL migration in Supabase, so the live data was consistent; this stops it recurring.

Tests written (in the scratchpad, deleted afterwards): a real-Postgres end-to-end run of the actual Flask routes (schema.sql + migrations applied, signed + CSRF requests) covering rename, combine into a new name, combine keeping an existing name, soft then hard delete, rollback atomicity and a concurrent settings save during a rename. Result: 21/21 pass with the fix, 9/21 with it disabled (fails exactly on the preference cases). Web build OK; client ordering logic 6/6. The throwaway Postgres and scripts were deleted. Not verified in a logged-in browser: the Chrome-extension and built-in browser tabs both report `document.hidden` (IndexedDB reads stall there), so the dashboard could not be exercised; the owner confirmed prod works.

**Watch after deploy:** the next real rename/combine in the admin panel is the true test; afterwards run `SELECT id FROM users WHERE preferences::text LIKE '%<old name>%'` (should be empty).

---

## 2026-09-30 — QA fixes (pushed)

Fixed from the QA report: `/home` phone overflow (`homePage.css` `.title` max-width), phone `/contents` crushed columns (`contentsStyles.css` ≤480px block + `TableHeader.jsx` clamps widths and reapplies when preferences load), category picker Escape/Cancel/`role=dialog` (`CategoryResolveModal.jsx` + `.modal-cancel-btn`), Year-view label shrink-to-fit and headroom 24→28 (`StackChartCanvas.jsx`), Data Security spacing (`DataSecurityScreen.jsx`), desktop `/contents` double scrollbars (`Layout.jsx` locks the shell on desktop contents; `.cs-container` is `flex: 1`, phone keeps `flex: none`).

Verified in a browser against a local fake API (deleted afterwards): home has no overflow and the title shrinks to fit; phone table description 82–91px and category 57–63px (was ~20–30); desktop page no longer scrolls while the list does and the footer sits at the bottom; picker closes via Escape, Cancel and backdrop; the Data Security phrases have their spaces; 5-digit Year totals are fully legible. Not verified: the clamp on saved widths (needs saved tiny widths to exercise), and it was not run against production.

**"Accomodation" spelling:** seed fixed in `schema.sql`, plus `migrations/rename_accommodation_category.sql`. The LIVE database still has the old name until the owner renames it (admin panel preferred). Do NOT run schema.sql before that (duplicate category). Page `<title>` left as is (5.3 was not requested).

---

## 2026-09-30 — Read-only browser QA round + theme-sync loop fix (committed, NOT pushed)

Four read-only testers ran in the owner's Chrome (landing/auth/timing, desktop features, phone/resize, admin/API). The phone/resize tester failed (Chrome's `resize_window` doesn't work with several testers sharing one browser) and was re-run using an iframe of controlled width instead; its result is pending.

**Bug found (Tester A and B, confirmed):** `useThemeSync` fired ~13-14 parallel `PATCH /categories` on every dashboard load, mostly 429. The `appliedChartTheme` localStorage flag was missing, and the flag was only set on full success, so once the 20/day category-write limit was hit it never got set and the burst repeated every load, burning the quota real category edits need. Fix in `customHooks/useThemeSync.js`: send only categories whose colour differs from the palette (steady state = zero requests), one at a time, stop at first failure, don't retry within the browser session (`sessionStorage chartThemeSyncTried`), skip users without `categories.recolor` (or owner). Build passes; not live-verified in a browser.

Side effect to know: the testers' loads triggered this sync, so up to 20 category-colour writes (same palette values) may have hit the DB today.

Other findings (not fixed): category picker modal isn't dismissible with Escape and has no close button; Year view clips the top totals for 2022/2023; "Accomodation" misspelled throughout; page `<title>` is "webui-temp"; Data Security copy is missing spaces in three places; double scrollbars on /contents; `/health` warm-up fetch is opaque. Backend and static headers, unauthenticated probes and admin login screen were clean.

---

## 2026-09-30 — Backend URL switched to Frankfurt (pushed, but not yet deployed)

`backend-url.json` and `NativeAppUI/localConfig.js` now point at `https://utility-tools-b6dj.onrender.com`. The three earlier commits (`/auth/me` single query, thread safety, URL file) are already pushed.

Probed the new service before switching (unauthenticated only): `/health` 200 in 0.17s, `/sync/state` and `/auth/csrf` exist (401 without a session), CORS allows the Pages origin with max-age 7200. So it runs the new code.

All three apps build; the cashflow production bundle embeds the new URL and none of the old.

**Next:** owner says ship, waits for the Cashflow, Landing and Admin deploys, hard-refreshes, and signs in once (cookies are per backend origin; cached data survives because the key comes from the same `IDB_MASTER_KEY`). Then I re-run the timing test in their Chrome. Delete the Oregon service only after it's confirmed working. To roll back: revert this commit.

**Watch:** admin CLI now targets the new service. The keep-alive workflow's cleanup call uses `backend-url.json` too. The old service's `FRONTEND_BASE_URL`-style variables were copied, so check that email links still point at the Pages site.

---

## 2026-09-30 — Backend made thread-safe (pushed) + agreed rollout order

Owner's plan: ship the code, create a new **Frankfurt** Render service with `--workers 1 --threads 8` and every env var copied (especially `IDB_MASTER_KEY`, `JWT_SECRET_KEY`, `DATABASE_SESSION_POOLER`), send me the new URL, then I replace the hard-coded backend URL.

**Order that must hold:** ship the thread-safety commit BEFORE the new service is created. Render builds from GitHub, so a service created earlier would run threads on the old non-thread-safe pool.

Code changes:
- `database.py`: `ThreadedConnectionPool`, minconn 3.
- `cache.py`: lock plus a single cold load, and snapshot iteration.
- `matching/merchants/cache_state.py`: locked lazy builds.
- `extensions.py`: the revocation retry now tries up to 3 connections.

Verified with a stubbed-DB concurrency test, 8/8:
- 12 simultaneous cold starts → 1 DB load (the old code did 12).
- Rename loops during concurrent inserts raise nothing.
- The automaton builds once.
- Stale-connection retry works and returns every connection.

Not done, deliberately: no semaphore around the pool. The worst case is 8 threads plus 2 background saves = 10 = maxconn.

**UPDATE: backend URL is now ONE file, `backend-url.json` at the repo root.** Read by cashflow (`frontendLocalConfig.jsx`), landing and admin (`api.js`), both `index.html` warm-up pings (via a small Vite plugin replacing `__BACKEND_URL__`), the admin CLI (`adminCliCommon.py`) and the keep-alive workflow (`jq`). To move the backend: edit that one file, plus `NativeAppUI/localConfig.js` (Expo/Metro can't import files outside its folder). Builds verified for all three apps.

**(Superseded list) URL was hard-coded in 8 places:** `tools/cashflow/frontendLocalConfig.jsx`, `tools/cashflow/WebUI/index.html`, `landing/src/api.js`, `landing/index.html`, `admin/src/api.js`, `tools/cashflow/NativeAppUI/localConfig.js`, `tools/cashflow/adminClI/adminCliCommon.py` (targets production on purpose, so confirm first), `.github/workflows/supabase-keep-alive.yml`. Also update the context docs that mention it. Login cookies are per backend origin, so the user must sign in once after the switch.

---

## 2026-09-30 — Measured the "slow return visit" in the owner's real Chrome

**Measurements (Claude in Chrome, read-only):**
- Cold backend: `/auth/me` 15.5 s (landing shows "Server is waking up").
- Warm return visits (Back to Tools → Cashflow, 3 runs): `/auth/me` ~1.42 s each, chart painted at 1.6–2.2 s, "Still connecting" never appeared.
- The encrypted snapshot is 440 KB; decrypt and paint take ~0.12 s after the key arrives.
- `appliedChartTheme` = `polished`, so the theme-recolour burst isn't firing for the owner. (It does fire on every visit for non-owners without `categories.recolor`: 13 PATCHes each get a 403 and the flag is never set. Still open.)

**Conclusion:** "Still connecting" = Render cold start. The warm-visit floor is `/auth/me`, and its cost is cross-region DB latency (Supabase eu-west-1, Render likely Oregon, ~200 ms per query). Collapsed `/auth/me` to one query (`_ME_BUNDLE_SQL` in routes/auth.py, with the legacy multi-query fallback). Ghost test 8/8.

**Owner decisions pending:**
- Move Render to Frankfurt.
- Handle cold starts: keep-alive ping or a paid instance.

---

## 2026-09-30 — White screen follow-up: entry URL before router + deep links

The user still saw white after `5197aad`. The live bundle did contain the fix, so that report was most likely the 10-minute Pages cache combined with landing prefetching cashflow.

Hardened anyway:
- **Cashflow:** `normalizeEntryUrl()` rewrites `/` to `/dashboard` or `/home` before React renders, and restores `?p=` deep links from an allowlist.
- **Landing:** `main.jsx` forwards `/utility-tools/cashflow/<path>`, which GitHub Pages serves with landing's 404 page, to cashflow as `?p=`. There's a loop guard, plus a `*` catch-all route.

Verified on production builds with the real base paths:
- Root at desktop → `/dashboard`; root at phone width → `/home`.
- `?p=/contents` → `/contents`.
- Hostile `?p` → `/dashboard`.
- `?p=/charts` at desktop → `/dashboard`.
- Landing forwards `/cashflow/dashboard` → `/cashflow/?p=%2Fdashboard` with no loop.

Test-harness lesson: `vite preview` needs `--base /utility-tools/cashflow/` because `vite.config` only sets base for `build`. Without it every asset falls back to `index.html`, which looks like a white-screen repro.

---

## 2026-09-29 — Hotfix: white screen on cashflow entry

`b8de3dc` shipped a ResponsiveGate redirect in `useLayoutEffect`. On first mount that navigate was lost, because BrowserRouter subscribes in its own later layout effect. Entering cashflow at `/` showed a white screen until a resize. Switched to `useEffect`.

Verified: fresh loads of `/` at desktop and at phone width render `/dashboard` and `/home` respectively. A live resize crossing couldn't be re-tested because the Browser pane was hidden, so confirm it on the deploy.

---

## 2026-09-29 — Cashflow boot overhaul (COMPLETE, shipped to main)

**Safe-point:** `6f05b58`. Ships frontend (cashflow + landing, GitHub Pages) and backend (Render).

**What was wrong (the real cause, after 4 failed attempts, see failed-solutions.md):** on return visits the sessionStorage hint let `UserPreferencesContext` fire `GET /preferences` before `/auth/me` returned. That caused:
1. The HMAC 401.
2. A refresh with CSRF "null", which failed.
3. `auth:session-expired`.
4. A hard redirect to landing `/login`.
5. Landing auto-forwarding back to cashflow.

The loop burnt the 100/day per-IP `/auth/me` limit, after which every boot failed. Any 429/5xx was also treated as logout.

**What changed:** see current-task.md "Recently Completed" for the file-level list. The key new modules are:
- `idb/bootSnapshot.js`
- `idb/persistence.js`
- `appState/UploadSessionContext.jsx`
- `routes/sync.py`
- `GET /auth/csrf` in `routes/auth.py`

**Verified locally:**
- Builds for cashflow and landing both pass.
- Backend Flask test-client ghost test, with the DB pool stubbed: 9/9.
- Browser run against a local fake API (all artifacts deleted after the test):
  - Cold boot: chart at ~1.25s, 9 requests.
  - Warm boot: chart ~80ms after `/auth/me` returns, only `/auth/me` on the critical path.
  - A server data change is detected in the background and only transactions are refetched.
  - Next visit fetches nothing.
  - Unreachable backend: shell plus "Still connecting…" bars, no full-page screen, no redirect.
  - Dead session: one redirect, and a second bounce shows the inline panel.
  - Breakpoint crossing keeps Layout mounted.
  - Chart mode survives a remount with zero requests.

**Not verifiable locally:** a real signed-in session against production (that would need real credentials or prod accounts). Watch the deploy.

**Open items:** new "Web boot / session / IDB pitfalls" section in known-problems.md. It covers the shared github.io origin risk, sendBeacon without HMAC, unused `StartupScreen.jsx`, the Render idle sleep, and pool/limiter process-locality.

---

## Pre-Compact Snapshot — 2026-09-29 21:48

**Git HEAD:** `c4709fa`
**Files touched:** tools/cashflow/WebUI/src/components/ProfilePopup.jsx, context/revert-state.md, context/handoff.md, tools/cashflow/WebUI/src/appState/TransactionsContext.jsx, tools/cashflow/WebUI/src/customHooks/homescreen/useLogout.jsx
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## 2026-09-29 — Spinner/oscillation fixes + admin accounts split (IN PROGRESS)

**Git HEAD:** `c4709fa` (pushed)

### Shipped this session

**Admin accounts → separate sidebar screens (51873ce, bc2446c):**
- Split tab-based `AdminAccountsScreen` into two separate screens
- `AdminAccountsScreen.jsx` — admin-only (level ≥ MIN_LEVEL)
- `UserAccountsScreen.jsx` — new file for user-level accounts (0 < level < MIN_LEVEL)
- `App.jsx` + `Sidebar.jsx` — new `/general/user-accounts` route + nav link

**Second-visit spinner oscillation fix (c4709fa):**
- Root cause: `auth_hint` in sessionStorage made `isLoggedIn=true` on mount while `idbReady=false`; TransactionsContext effect fired immediately with partial state → spinner, empty IDB read, server fetch start; when `getMe()` resolved `idbReady` flipped, effect re-ran with `firstLoadDoneRef` still false → spinner again
- Fix: `TransactionsContext.jsx` — gate effect on `!isLoggedIn || !idbReady` so it never fires with partial state

**REGRESSION introduced (not yet shipped fix):**
- `endSession()` calls added to `useLogout.jsx` and `ProfilePopup.jsx` caused `RequiresAuth` to catch `isLoggedIn=false` and redirect to login → cookies still valid → auto-redirected back to cashflow instead of landing page
- **Reverted** both `endSession()` additions — `useLogout.jsx` and `ProfilePopup.jsx` restored to original behaviour

### Active investigation

IDB not persisting between visits — background agent running. Symptom: every return fetches fresh from server, "server starting" message appears even on warm server. Likely cause: IDB write not completing, or staleness TTL too short, or `idbReady=true` before crypto key is actually set.

### What still needs doing

1. Apply IDB persistence fix (pending agent report)
2. Build WebUI
3. Commit + ship

---

## Pre-Compact Snapshot — 2026-09-29 15:17

**Git HEAD:** `d82ff1e`
**Files touched:** context/revert-state.md, context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-28 00:00

**Git HEAD:** `fa5417b`
**Files touched:** context/savings-log.md, context/session-snapshot.md, context/revert-state.md, context/handoff.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 23:29

**Git HEAD:** `7d23ce3`
**Files touched:** context/revert-state.md, context/savings-log.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 21:29

**Git HEAD:** `51f17ef`
**Files touched:** context/handoff.md, context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 19:21

**Git HEAD:** `5d77a78`
**Files touched:** context/handoff.md, context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 17:32

**Git HEAD:** `78b81ef`
**Files touched:** context/session-snapshot.md, context/handoff.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## 2026-09-27 — Task 25: Encrypted IndexedDB layer (SHIPPED 78b81ef)

**What shipped:**
- Envelope encryption: `IDB_MASTER_KEY` KEK in `.env` + Render env; per-user AES-256-GCM DEK in `user_idb_keys` table
- `crypto/idb_keys.py` — `get_or_create_dek()`, encrypt/decrypt DEK with KEK
- `migrations/add_user_idb_keys.sql` — **already run on Supabase**
- `/auth/login`, `/auth/signup`, `/auth/me` return `idb_key` + `user_id`
- `GET /categories` returns `version` field for staleness detection
- `PUT /preferences` blocks `idb_key` from client overwrites
- `src/idb/crypto.js` — AES-256-GCM Web Crypto
- `src/idb/store.js` — per-user `cashflow-db-{userId}` with 6 stores + staleness API
- `src/idb/writeQueue.js` — optimistic queue, drain on focus/online, rollback on permanent failure
- `api.jsx` — DEK imported as CryptoKey on login/signup/getMe; key nulled on logout (IDB blobs persist)
- `UserPreferencesContext.jsx` — IDB instant hydration + server authoritative; localStorage fully removed
- `TransactionsContext.jsx` — IDB cache hydration + staleness + `optimisticUpdateTransactions`

**What was deliberately left on localStorage:** `theme` and `appliedChartTheme` (non-sensitive, synchronous boot requirement)

**Admin IDB (`cashflow-admin-db-{userId}`) not yet wired** — separate future task.

**Next:** Task 10 (React Native) or Tasks 3+4 (Stripe billing — P1 Critical).

---

## 2026-09-27 — HMAC login bug fix (SHIPPED e5d4d9b)

**Bug:** Login broken on prod — "HMAC verification failed: Missing HMAC headers"

**Root cause:** `extensions.py` HMAC `before_request` hook skips unauthenticated requests, but users with a stale `access_token_cookie` from a previous session hit the login POST with a cookie present → hook tries to HMAC-verify `/auth/login` → fails because landing page never sends HMAC headers on auth endpoints.

**Fix (one line in `tools/cashflow/API/extensions.py` ~line 150):**

Find:
```python
if req.path.startswith('/admin/'):
    return
```
Change to:
```python
if req.path.startswith('/admin/') or req.path.startswith('/auth/'):
    return
```

Auth routes (`/auth/login`, `/auth/signup`, etc.) should always be exempt from HMAC — they're session-creation endpoints with no signing secret yet. Rate limiting + brute-force lockout protect them instead.

**Why Claude couldn't apply it:** auto-classifier blocked as "Security Weaken". User must apply manually and push.

---

## 2026-09-27 — Task 1: tools JWT claim wiring (IN PROGRESS — one blocker)

### What was done

**tools JWT claim added to all issuance points (`routes/auth.py`):**
- Login (line ~730): `additional_claims={'tools': ['cashflow']}` on both `create_access_token` and `create_refresh_token`
- Signup (line ~809): same
- Refresh (line ~849): reads existing `tools` claim from incoming refresh token via `get_jwt().get('tools', ['cashflow'])` and carries it forward — fallback to `['cashflow']` if old token has no claim

**All 22 bare `@jwt_required()` replaced with `@require_auth()` in cashflow route files:**
- `routes/categories.py` (9 routes) — import updated
- `routes/charts.py` (1 route) — import added
- `routes/preferences.py` (2 routes) — import added
- `routes/uploads.py` (1 route) — import added
- `routes/transactions/categorisation_routes.py` (8 routes) — import added
- `routes/transactions/crud.py` (3 routes) — import added
- `routes/transactions/upload.py` (1 route) — import added

**`require_auth()` in `middleware/user_middleware.py`:**
- Added `tool='cashflow'` param
- Currently checks: `if tool not in claims.get('tools', []):` → returns 403

### ONE BLOCKER — needs user decision before ship

**File:** `tools/cashflow/API/middleware/user_middleware.py` ~line 119

**Issue:** Current enforcement is strict — tokens without any `tools` claim (all tokens issued before this deploy) return 403 on every Cashflow route. This breaks all active sessions for up to 30 min post-deploy (until access tokens refresh).

**Ghost-test verdict:** REVISE — change enforcement to fail-open for absent claim.

**The fix (one line change in user_middleware.py ~119):**

Replace:
```python
if tool not in claims.get('tools', []):
    return jsonify({'error': 'Subscription required', 'code': 'no_tool_access'}), 403
```
With:
```python
tools_list = claims.get('tools')
if tools_list is not None and tool not in tools_list:
    return jsonify({'error': 'Subscription required', 'code': 'no_tool_access'}), 403
```

**Why:** Absent claim = old token (pre-deploy) → allow through. Present claim without 'cashflow' = future enforcement (when Stripe is live). After the 30-min refresh cycle, all active tokens will have the claim and enforcement is full.

**The auto-classifier blocked this edit as "Security Weaken" — user must apply it or explicitly approve.**

### CORS + blueprint isolation
Both clean — audit subagent confirmed:
- Production CORS locked to `https://ideas-of-stuff-to-learn.github.io` only
- Zero cross-contamination between auth routes and cashflow routes

### What's NOT committed yet
All route file changes are uncommitted local edits. Nothing shipped. Once user decides on the blocker, apply the fix then `/ship-main`.

### Next after ship
Task 1 complete. Next: Task 6 (subdomain) gated on domain purchase, or Task 25 (IndexedDB), or continue to Task 5 (JWT gating enforcement tightening when Stripe is ready).

---

## Pre-Compact Snapshot — 2026-09-27 15:59

**Git HEAD:** `6de1cac`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 15:27

**Git HEAD:** `a74070d`
**Files touched:** context/session-snapshot.md, context/handoff.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 14:14

**Git HEAD:** `8c78077`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-27 01:44

**Git HEAD:** `5475406`
**Files touched:** admin/src/components/Sidebar.jsx, tools/cashflow/API/permission_weights.py, tools/cashflow/API/schema.sql, admin/src/utils/permissionWeights.js, tools/cashflow/API/routes/admin_auth.py
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## 2026-09-27 — Admin panel shipped + permission-derived role levels

**Git HEAD:** `060a206` (main, pushed)

### What was done

**Admin panel (Tasks 27+26+23) — all shipped:**
- `admin_users` table completely separate from cashflow `users` — credential isolation
- TOTP two-step login: credentials → temp_token → TOTP verify → session cookies (`admin_access_token` / `admin_refresh_token`)
- `admin_auth.py`: full auth flow, TOTP enrolment on first login, `/admin/me`, account CRUD
- `require_admin_auth(permission_key)` decorator for all admin routes
- Admin panel Vite/React app (`admin/`): Login, TOTP setup, sidebar, Users, Roles, Unlock Account, Admin Accounts screens
- `ForgotPasswordScreen` replaced with info page (contact owner to reset)
- "Not authorised to edit" shown for same/higher-level rows; "N/A" in Unlock for non-locked accounts
- `ADMIN_ACCOUNT_MIN_LEVEL=30` — floor below which roles can't be assigned to admin accounts (env var, Render + local)

**Permission-derived role levels:**
- `tools/cashflow/API/permission_weights.py` + `admin/src/utils/permissionWeights.js` — canonical weight table (18 permissions, unique values, sum clamped 1–99)
- `computeRoleLevel()` derives level purely from selected permissions
- `RolesScreen.jsx` — level is auto-computed read-only; red non-button replaces Save when computed level ≥ caller's level
- `ADMIN_LEVEL_OVERRIDE_MIN=80` — admins at/above this level get editable override field; formula shown as suggestion; hard cap: can't set ≥ own level
- Backend (`admin.py`) recomputes level server-side, rejects mismatches, enforces override privilege
- Level 0 when no permissions selected (not 1); Select All / Deselect All buttons in role modal

**Local dev infra:**
- `dev.config.env` — single source of truth for ports + thresholds
- `start-dev.bat` — reads config, writes `.env` files, launches all four servers
- Flask on port 5050 (5000 stolen by Windows svchost)
- CORS regex `r"http://localhost(:\d+)?$"` allows all localhost ports in dev
- Admin panel link in ProfilePopup fixed (was looping back to landing page)

### Render env vars to add (not yet added)
- `ADMIN_ACCOUNT_MIN_LEVEL=30`
- `ADMIN_LEVEL_OVERRIDE_MIN=80`

### Global admin audit log (ffdc157)
- `admin_audit_log` table + `audit.py` shared writer
- Writes on: roles.create/edit/delete, users.assign_role, users.impersonate, admin.account.create/delete
- `GET /admin/audit` — filterable by actor + action, gated by `ADMIN_AUDIT_MIN_LEVEL=60`
- `AuditLogScreen.jsx` — filterable table in sidebar (hidden below audit min level)
- Supabase SQL run by user ✓ | Render env var `ADMIN_AUDIT_MIN_LEVEL=60` added ✓

### Still to do / open
- Delete the "admin" role from Supabase (randomly created, no one using it):
  ```sql
  SELECT COUNT(*) FROM admin_users WHERE role_id = (SELECT id FROM roles WHERE name = 'admin');
  -- if 0:
  DELETE FROM roles WHERE name = 'admin';
  ```
- Add `admin.accounts.manage` permission for tab visibility gate (discussed, not yet implemented)
- Local testing in progress — user was verifying role level formula and Select All behaviour

---

## Pre-Compact Snapshot — 2026-09-27 00:44

**Git HEAD:** `10f3bf4`
**Files touched:** tools/cashflow/WebUI/vite.config.js, tools/cashflow/API/schema.sql, context/revert-state.md, admin/src/components/Sidebar.jsx, admin/src/screens/Auth/ForgotPasswordScreen.jsx...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-26 23:19

**Git HEAD:** `10f3bf4`
**Files touched:** context/handoff.md, tools/cashflow/start-web.bat, start-landing.bat, tools/cashflow/API/backend.py, landing/src/App.jsx...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-26 22:36

**Git HEAD:** `10f3bf4`
**Files touched:** start-landing.bat, tools/cashflow/backendLocalConfig.py, tools/cashflow/start-web.bat, landing/src/App.jsx, context/handoff.md...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-26 18:42

**Git HEAD:** `b9fb398`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-24 20:43

**Git HEAD:** `7e49833`
**Files touched:** tasks/backlog.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## 2026-09-24 — Level-ceiling enforcement + email CC matrix + cancel emails

**Commits:** `29c113d`, `3d9af1d`, `e6ffe8b`

**What was done:**
- Hard rule: no account can manipulate another at or above its own level — no exceptions, no owner bypass. Applied to delete role, cancel-delete role, assign role (both user-level and target-role-level checks), unlock user, view transactions, list users.
- `email_service.py`: added `cc_address` param to `send_email` (Brevo cc array)
- New `_send_deletion_cancelled_email` helper; all deletion email helpers updated to To: actor, CC: owner
- New `_get_caller_email` helper; actor email stored at schedule time in `pending_deletion_by_email`
- `categories.py`: stores actor email at schedule; sends cancel email; imports helpers from routes.admin
- `process_pending_deletions`: uses actor email for role/category confirmed emails; CC owner on user account permanent-deletion
- `PROTECTED_ROLE_NAMES` check removed from role deletion (redundant — level-ceiling + user-assignment check already cover it)
- Fixed `_get_owner_email` — was using non-existent `user_roles` junction table; schema uses `users.role_id` directly
- `RolesScreen.jsx`: hide Edit/Delete for roles >= caller level; owner modal bypass removed
- `UsersScreen.jsx`: hide Change Role for users >= caller level; roles dropdown filtered to level < caller
- Migration run: `pending_deletion_by_email TEXT` added to roles and categories tables

**Migrations run by user:**
- `add_pending_deletion_at.sql` (previous session)
- `add_pending_deletion_by_email.sql` (this session)

**Status:** All working in production. Emails landing (in Outlook "Other" tab — user moved to Focused).

## Pre-Compact Snapshot — 2026-09-24 19:53

**Git HEAD:** `285970a`
**Files touched:** context/handoff.md, context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-24 19:08

**Git HEAD:** `9ed512a`
**Files touched:** context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-24 17:59

**Git HEAD:** `6202034`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## 2026-09-24 — Email flow fully working end-to-end

**Commits:** `82faa98` (Brevo HTTP API), `def2130` (Brevo SMTP attempt), `6f2e7cb` (IPv4 force), `b4a0a59` (port 587)
**Root cause chain:** port 465 blocked → port 587 blocked → Brevo SMTP also blocked → switched to Brevo HTTP API (HTTPS/443, never blocked). `FRONTEND_BASE_URL` was set to GitHub repo URL instead of GitHub Pages URL — fixed by setting to `https://ideas-of-stuff-to-learn.github.io/utility-tools` in Render env vars.
**Status:** Email verification, forgot password, cancel-deletion all working in production.

---

## 2026-09-24 — ProxyFix + rate-limit global bucket fix shipped

**Commits shipped:** `b09b9ce` (ProxyFix + remove default_limits), `5b8e64a` (forgot_password email order), `7b38603` (security audit fixes), `62c804c` (SMTP timeout)
**Root cause resolved:** Render's shared proxy IP + `default_limits=["20 per day"]` caused page-load startup GETs to exhaust the global bucket before any user could add email. Fix: ProxyFix (real client IPs) + `default_limits=[]` (no cross-route bucket pollution).
**Status:** Pushed to main, deployed on Render.

---

## Pre-Compact Snapshot — 2026-09-24 12:35

**Git HEAD:** `b09b9ce`
**Files touched:** context/handoff.md, context/revert-state.md, context/session-snapshot.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-23 21:57

**Git HEAD:** `62c804c`
**Files touched:** context/session-snapshot.md, context/revert-state.md, context/handoff.md
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-23 20:34

**Git HEAD:** `a5f51b8`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-23 19:53

**Git HEAD:** `910fcb6`
**Files touched:** tools/cashflow/start-all.bat, context/handoff.md, context/session-snapshot.md, tools/cashflow/start-rn.bat, tools/cashflow/start-web.bat...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-23 19:00

**Git HEAD:** `07979ee`
**Files touched:** App/WebUI/src/styles/chartStyles.css, App/WebUI/src/screens/Dashboard.jsx, context/handoff.md, App/WebUI/src/styles/dashboardStyles.css
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Session handoff — 2026-09-23

**Git HEAD:** `cba0d37`
**Branch:** main (pushed)

### What was done this session

**Tasks 3–5 — email verification, password reset, profile UI, soft-delete (cba0d37):**
- `POST /auth/send-verification` + `GET /auth/verify-email` — 5-min JWT, one-time use, 60s cooldown + 5/day cap, owner bypasses via `email.bypass_ratelimit` permission
- `POST /auth/forgot-password` + `POST /auth/reset-password` — bot detection layers 1–4 (IP rate limit, per-account lockout, honeypot field, timing check); login brute-force: 5 failed → 15-min auto-lock (`login_locked_until`)
- `POST /auth/change-password` — verifies current password, hashes new one
- `PATCH /auth/profile` — updates `display_name` or sets `pending_email` (no immediate email change; old address active until new one verified)
- `DELETE /auth/account` — sets `deleted_at`, sends 48h cancellation email with JWT link
- `POST /auth/cancel-deletion` — clears `deleted_at` within 48h window
- New screens: `VerifyEmailScreen`, `ForgotPasswordScreen`, `ResetPasswordScreen`, `ProfileScreen`, `CancelDeletionScreen`
- `ProfilePopup.jsx` — clickable avatar/badge shows popup with name, email, verified badge, pending email, Edit Profile + Sign out buttons
- `RoleBadge.jsx` — rewritten: elevated role = colored badge button, regular user = avatar circle button; both open ProfilePopup
- `App.jsx` — routes added: `/profile`, `/cancel-deletion`, `/forgot-password`, `/reset-password`, `/verify-email`
- `schema.sql` — `deleted_at TIMESTAMPTZ`, `pending_email TEXT`, brute-force columns, email rate-limit columns all added
- `supabase-keep-alive.yml` — daily schedule, soft-deleted users query as keep-alive, hard-delete step via `SUPABASE_SERVICE_ROLE_KEY` for accounts past 48h window
- start-*.bat — window titles renamed from "Cashflow" → "utility-tools"

**Post-ship UI fixes (shipped separately):**
- `ProfilePopup.css` — `position: fixed; top: 56px; right: 12px; z-index: 1001; background: var(--bg-page)` — portal render via `createPortal` to document.body so popup escapes `.app-header` stacking context; background fixed (`--surface` undefined → transparent, switched to `--bg-page`)
- `RoleBadge.jsx` — popup rendered via `createPortal(…, document.body)`
- `Layout.css` — `.app-header` gets `position: relative; z-index: 10`
- `dashboardStyles.css` — `.dashboard-chart-area`: `overflow: hidden`, `padding-top: 16px`, `padding-bottom: 8px`; nav row `margin-bottom: 0`
- `chartStyles.css` — `.chart-header-row`: `margin-top` removed, `flex-shrink: 0` added (prevents flex from compressing title row to zero under tight height)
- Logout button fix: reverted `overflow: visible` (was causing invisible overflow to block left-panel clicks) back to `overflow: hidden`; title stays visible because `flex-shrink: 0` stops the header row being squished

### DB migrations run by user this session
- `deleted_at TIMESTAMPTZ` and `pending_email TEXT` added manually in Supabase
- `failed_login_attempts`, `login_locked`, `login_locked_until` — user prompted to add these after 500 error on login

### Open / pending
- `SUPABASE_SERVICE_ROLE_KEY` GitHub secret added by user this session
- Next task: Task 6 — Google/Microsoft OAuth

---

## Pre-Compact Snapshot — 2026-09-23 18:16

**Git HEAD:** `71241d4`
**Files touched:** context/revert-state.md, App/WebUI/src/api.jsx, context/savings-log.md, start-web.bat, App/API/rate_limits.py...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-23 17:19

**Git HEAD:** `71241d4`
**Files touched:** context/current-task.md, start-web.bat, context/savings-log.md, start-all.bat, context/revert-state.md...
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

## Pre-Compact Snapshot — 2026-09-23 15:09

**Git HEAD:** `eb0073b`
**Files touched:** (none — no uncommitted changes)
**Active task:** (no active task)

*(Auto-written by PreCompact hook — full snapshot in context/session-snapshot.md)*

---

# Cashflow2.0 — Handoff

## Status (2026-09-21)

No active task. Clean main branch. Auth & platform architecture fully designed — ready to implement next session.

## What Was Just Done

**Auth & platform architecture design session (2026-09-21):**
- Full discussion covering all auth layers — no code changed, design only
- Agreed design written to `context/auth-design.md` (new file)
- Key decisions: email replaces username as login credential; display_name optional; Gmail SMTP for email sending; Google + Microsoft OAuth (personal + work accounts, both free); Stripe per-tool billing; monorepo platform structure; profile popup + /profile page
- Implementation order agreed (see auth-design.md §9)
- Open questions not yet answered: platform name, Gmail address, Stripe tier specifics, trial terms, existing user migration policy, domain name
- RN OAuth parked — note needed when doing task 10: RN needs `expo-auth-session` + different redirect URI scheme (`cashflow://auth/callback`)

## Status (2026-09-20)

No active task. Clean main branch.

## What Was Just Done

**Responsive modal / popup audit + dashboard chart spacing (2026-09-20):**
- Audited all 17 CSS files + 44 JSX components — every modal/popup/overlay in WebUI
- `manualReviewModal.css` `.mr-card`: `overflow: hidden` → `overflow-y: auto` + `max-height: 90vh` — was clipping category grid off-screen on small viewports
- `dashboardStyles.css` `.dashboard-chart-area`: `padding-top: 12px` — chart title was squashed against top of chart box
- `contentsStyles.css` `.modal-card`: `overflow: hidden` → `overflow-y: auto`, `max-height: 70%` → `70vh`
- `contentsStyles.css` `.modal-list`: added `flex: 1; min-height: 0` to base rule (was only in `@media (max-width: 1023px)`) so category list can scroll within card on desktop
- Surfaces confirmed fine (no change needed): segment-popup-floating, upload-files-popup-box, manual-review-modal (stats), all mr-card-narrow variants
- Commits: `46beece` (chart + mr-card), `a37dda1` (modal-card/modal-list), pushed to main

**Rate limiting overhaul — granular disable flags (2026-09-20):**
- `App/API/rate_limits.py` rebuilt with per-endpoint callable constants
- `DISABLE_ALL_RATE_LIMITS = False` (line 33) — one toggle to kill everything
- Individual flags: `DISABLE_RL_READ_TRANSACTIONS`, `DISABLE_RL_READ_CATEGORIES`, `DISABLE_RL_READ_CHARTS`, `DISABLE_RL_READ_UPLOADS`, `DISABLE_RL_READ_ADMIN`, `DISABLE_RL_AUTH_*`, `DISABLE_RL_PREFERENCES_*`, `DISABLE_RL_CATEGORY_WRITE`, `DISABLE_RL_CATEGORISE_*`, `DISABLE_RL_UPLOAD`, `DISABLE_RL_ADMIN_SENSITIVE`
- GET /transactions and GET /categories: decorators re-enabled (were commented out), wired to new constants; toggle via flags, not comments
- Route files: charts.py→RL_READ_CHARTS, uploads.py→RL_READ_UPLOADS, admin.py→RL_READ_ADMIN, categories.py→RL_READ_CATEGORIES, crud.py→RL_READ_TRANSACTIONS + RL_READ_UPLOADS
- Callable pattern: `@limiter.limit(RL_READ_TRANSACTIONS)` calls the function at request time — flag changes take effect immediately without server restart

**UI polish + chart theme system (2026-09-20):**
- btn-secondary + logout-btn: themed fill (var(--primary-light) / var(--primary)) instead of hardcoded green/red
- chartColors.js: 14-colour palettes per theme; useThemeSync auto-pushes on load when theme has changed
- Dashboard scroll fixed: app-shell-locked height: 100% + min-height: 0

## What Was Just Done

**Theme system — CSS tokens + light/dark toggle (2026-09-20):**
- `src/styles/theme.css` — single source of truth: all UI colour tokens as CSS custom properties on `:root`, with `:root[data-theme="dark"]` overrides for backgrounds, text and borders. Brand colours (primary, danger, success, gold) unchanged in dark mode.
- `src/theme.js` — JS-facing exports: `ROLE_COLORS`, `DEFAULT_ROLE_COLOR`, `FALLBACK_CATEGORY_COLOR`, `CHART_COLORS` (14-colour rotation, ready to swap), `initTheme()`, `toggleTheme()`, `getTheme()`.
- `src/main.jsx` — imports `theme.css` globally, calls `initTheme()` before render (reads `localStorage.getItem('theme')`, sets `data-theme` attribute on `<html>`).
- `src/components/ThemeToggle.jsx` — 🌙/☀️ button; calls `toggleTheme()`, persists to localStorage, updates instantly.
- `Layout.jsx` — ThemeToggle added to `app-header-right` alongside RoleBadge.
- **15 CSS files swept** — every hardcoded hex replaced with the appropriate `var(--token)`: Layout.css, filterPaneStyles.css, homePage.css, chartStyles.css, contentsStyles.css, LoginScreen.css, manualReviewModal.css, segmentPopup.css, stackedChartStyles.css, shared.css, rangeWindowSlider.css, uploadFilesPopup.css, chartFootnote.css, dashboardStyles.css, ProgressBar.css, LoadingBarsPlaceholder.css.
- **JS/JSX swept** — RoleBadge imports ROLE_COLORS from theme.js; chartUtils.jsx re-exports CHART_COLORS as COLOR_PALETTE from theme.js; all `'#BBBBBB'` fallbacks replaced with `FALLBACK_CATEGORY_COLOR` import.
- dataSecurityStyles.css intentionally left unchanged (bespoke document palette).
- Task 14 marked done in backlog.

## What Was Just Done

**App title centralisation, header layout overhaul, filter pane, mobile polish (2026-09-20):**

- **`App/WebUI/src/appTitle.js`** — new single-source constant `APP_TITLE = 'Personal Spending Pattern Visualisation Tool'`. All three previous hardcoded title strings replaced with this import (Layout.jsx, homepageInfo.jsx, LoginScreen.jsx). Change title by editing one line only.
- **`Layout.jsx` — dynamic title font scaling** — ResizeObserver on the dashboard `<h1>` steps font-size down from CSS base (15px) by 0.5px until `scrollWidth <= offsetWidth`; floor 9px. Reads base from `getComputedStyle` so CSS is authoritative.
- **`homepageInfo.jsx` — same ResizeObserver** applied to the mobile home title (CSS base 24px, floor 10px). `white-space: nowrap; overflow: hidden` added to `.title` class in `homePage.css`.
- **`Layout.jsx` header — flex layout replacing CSS grid** — three explicit wrappers: `.app-header-left` (`flex: 0 1 auto`, shrinks to title content), `.app-header-center` (`flex: 1`, fills gap and centers buttons within it), `.app-header-right` (`flex: 0 0 auto; min-width: 80px`, always reserves badge space so centering is symmetric even when RoleBadge returns null). Result: center buttons always sit midway between title right-edge and badge left-edge, tracking the title as it scales.
- **Mobile pills routing** — `(isDashboard || isCharts)` condition replaced with `(isDashboard || (isCharts && !isMobile) || (isHome && isMobile))`. User Information / Data Security now hidden on mobile `/charts`; added to mobile `/home`.
- **Filter pane spacing** — header border-bottom removed; `.filter-pane-header` margin/padding halved; section margins reduced 6→3px; checkbox row padding 2→1px; section-title/hint margins 4→2px; pane gap 2→1px; pane padding 12→10px vertical. Base font bumped 13→14px so JS auto-scale lands higher.
- **User Information popup mobile** — `max-height: calc(100vh - 32px); overflow-y: auto; scrollbar-width: none` + `::-webkit-scrollbar { display: none }` on `.info-modal`. Close button changed from `position: absolute` to `position: sticky; top: 0; float: right` so it stays visible while content scrolls. Same `max-height` + scroll applied to `.info-modal-footnote`.

## What Was Just Done

**Dashboard layout + info pages (2026-09-17):**
- `ChartFootnote` removed from inline position in Dashboard and ChartsScreen; moved into a modal popup triggered by a "User Information" pill button in the header center column (dashboard + charts routes)
- New `FootnoteModal` in `Layout.jsx` renders `<ChartFootnote />` inside a styled overlay; keeps nth-child bold/red rules via scoped CSS in `Layout.css`
- "🔒 Data Security" pill added next to "User Information" — navigates to `/data-security`
- New `DataSecurityScreen.jsx` — full JSX port of `docs/data-security.html` with back button (`navigate(-1)`); own CSS in `dataSecurityStyles.css`; route wired in `App.jsx` outside `<Layout />`
- `html, body` reset (`overflow: hidden; height: 100%; margin: 0`) kills browser scrollbar at root
- `app-shell` changed from `min-height: 100vh` to `height: 100vh; overflow: hidden` — true viewport lock
- `#root { padding-top: 10px }` adds breathing gap between viewport top and header
- Footer border removed (legal links visually cleaner at bottom)
- `dashboard-flex`: `align-items: stretch; flex: 1; min-height: 0` — fills full content height
- `dashboard-home-box`, `dashboard-main`, `dashboard-charts-box`: flex column, stretch to full height
- FilterPane: `position: sticky` + `align-self: flex-start` removed — now stretches with flex row
- `dashboard-chart-area`: `display: flex; flex-direction: column` — enables nav row push
- `.dashboard-chart-area .window-nav-row { margin-top: auto; margin-bottom: -4px }` — nav arrow bottom-aligns with Log Out and filter pane bottom edge
- `BASE_CHART_HEIGHT` bumped 170 → 270 in `SpendingStackedChart.jsx` — chart fills more of the available space
- All `calc(100vh - Npx)` values updated: cs-container → 89px, chartStyles sidebar → 89px

## What Was Just Done

**Manual review UX + stats fixes (2026-09-17):**
- `ManualReviewStatsModal.jsx`: decimal percentage display (e.g. `0.40%`); ≥1% whole number
- `ManualReviewGate.jsx`: optimistic exit with race pattern — instant close if server < 400ms, spinner fallback if slow, error screen if both retries fail; "All done!" path fully optimistic with 900ms close delay
- `ManualReviewSequentialModal.jsx`: small centered saving card, spinner + checkmark, full flushing/exitFailed framework kept for future use
- `categorisation_routes.py`: `/categorize/resolve-and-exit` — picks + remaining-to-Other in one transaction
- `api.jsx`: `resolveAndExit()` added
- `tasks/backlog.md`: task 17 added (owner admin page, P4)
- Test SQL: `_mr_test_backup` table + parameterised flip/restore query

**FilterPane order/persist bug fixes (2026-09-17):**
- `useStackOrder.jsx`: hydration effect no longer filters `savedOrder` against `categoryNames` (empty on mount). Sets raw saved order directly; `effectiveOrder` filters reactively.
- `FilterPane.jsx`: "Remember this order" and "Reset to default" both gated on `isCustomOrder` (previously "Remember this order" always showed).
- `UserPreferencesContext.jsx`: added `flushNow()` — cancels debounce and immediately PUTs to server. Exposed from context.
- `useStackOrder.jsx`: `togglePersist` and `resetOrder` both call `flushNow()` so the DB write is guaranteed before a reload, not dependent on the 2s debounce or `beforeunload`.

Root cause of "filters disappear on reload": server had stale `stackPersist: false` (debounce hadn't fired before reload), server hydration on reload overwrote localStorage `stackPersist: true` with `false`, causing `useStackOrder` to treat order as non-persisted.

---

## Status (2026-09-16)

No active task. Pending push to main.

## What Was Just Done

**UserPreferences context + column resize persistence + info popup + delete removal** (2026-09-16):

- **New file: `App/WebUI/src/appState/UserPreferencesContext.jsx`** — unified preferences context consolidating column widths, stack order, stack persist flag, and manual review picks. Reads from localStorage on mount, hydrates from server on login (server is authoritative), and debounces server PUT (2s after last change).
- **New file: `App/API/routes/preferences.py`** — `GET /preferences` + `PUT /preferences` (JWT required). Partial JSONB merge via `||` operator so only changed keys are overwritten.
- **`App/API/schema.sql`** — added `ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb`.
- **`App/API/backend.py`** — added `import routes.preferences`.
- **`App/WebUI/src/api.jsx`** — added `getPreferences()` and `putPreferences(patch)`.
- **`App/WebUI/src/appState/index.jsx`** — added `UserPreferencesProvider` as 2nd level (inside AuthProvider, wrapping ProcessingProvider); exported `useUserPreferences`.
- **`App/WebUI/src/customHooks/charts/useStackOrder.jsx`** — migrated stack order reads/writes to `useUserPreferences` context.
- **`App/WebUI/src/components/manualReview/ManualReviewGate.jsx`** — migrated MR picks reads/writes to `useUserPreferences` context.
- **`App/WebUI/src/appState/TransactionsContext.jsx`** — migrated MR picks reload-flush to `useUserPreferences` context.
- **`App/WebUI/src/components/contents/TableHeader.jsx`** — column resize handles persist widths to context via `setColumnWidths` on drag end; applied saved widths from context on mount; console logs on mount and after drag (DevTools F12 → Console).
- **`App/WebUI/src/components/contents/SelectionBar.jsx`** — removed Delete button and `onDelete`/`deleting` props.
- **`App/WebUI/src/screens/ContentsScreen.jsx`** — removed `onDelete`/`deleting` props from SelectionBar usage.
- **`App/WebUI/src/components/Layout.jsx`** — added ℹ button next to "Transactions" title; clicking it shows `TransactionsInfoModal` explaining page purpose, search, single/bulk category change, column resize, and sort.
- **`App/WebUI/src/styles/Layout.css`** — added `.info-icon-btn`, `.info-modal-overlay`, `.info-modal`, and supporting styles.

**Context chain for provider nesting:** `AuthProvider → UserPreferencesProvider → ProcessingProvider → TransactionsProvider → ChartFilterProvider`

**Preferences sync lifecycle (final):**
- Change → localStorage (instant) + React context (instant) + debounce 2s → server PUT
- `beforeunload` → reads localStorage, cancels debounce, keepalive fetch → server PUT (all 4 keys incl. mrPicks)
- Login (`isLoggedIn` false→true, every page load) → single `serverGet()` → overwrites localStorage + context (server authoritative)
- `BASE_URL` imported from `frontendLocalConfig` directly in UserPreferencesContext (same source as api.jsx)

**ContentsScreen virtualizer fix (2026-09-16):**
- Root cause: `.cs-container { height: 100% }` resolved to `auto` because `.app-shell` uses `min-height: 100vh` not `height: 100vh` — broken height chain meant `useVirtualizer` had no bounded scroll container and rendered all 3700+ rows on every mount
- Fix: `.cs-container { height: calc(100vh - 48px) }` — explicitly bounded, bypasses the broken chain
- The `@media (max-width: 700px)` breakpoint for mobile CSS overrides was mismatched with the JS `isMobile` threshold of 1024px — at 700–1023px, window scroll was used (JS) but desktop CSS applied (no sticky sidebar, no overflow:visible). Fixed by changing media query to `max-width: 1023px`
- Side effect of the height fix: navigation to `/contents` became instant (was rendering all rows = slow mount)

## What Was Just Done (Previously)

**Manual review UX fixes** (2026-09-15, previous session):
- Reload persistence: picks accumulated mid-review are stored in `localStorage` (`mr_pending_picks`); on reload `TransactionsContext` flushes them to DB before triggering the flow, so remaining count is accurate and completed picks aren't lost
- Exit button: small red "Exit" bottom-right of each categoriser popup; opens confirmation overlay explaining remaining go to Other; Confirm exit / Go back options
- Exit-confirm error recovery: if save fails, shows "Something went wrong — Retry exit / Go back" instead of a dead end
- Retry wiring: sequential flush error Retry button now correctly retries the flush (was wired to no-op)
- Auto-logout: `api.jsx` fires `auth:session-expired` custom event when refresh token is rejected; `AuthContext` listens and calls `endSession()` — kicks to login screen instead of looping with errors
- File list clears: selected file names under "Choose CSV files" clear automatically when manual review flow resolves (both `HomeScreen` and `Dashboard`)
- Progress update rule: added to CLAUDE.md, constraints.md, and spec section 54

**DB reset SQL fix** (2026-09-15):
- Old pattern (DELETE + INSERT users) created a new user_id, invalidating the JWT cookie — caused "parsing failed" loop until manual logout
- Correct pattern: `UPDATE users SET password_hash = '...' WHERE username = 'owner'` preserves user_id; `TRUNCATE transactions, category_records, uploaded_files, merchants`
- In-memory global cache (`_global_records_cache` in `cache.py`) must be cleared by restarting the Flask process after a DB reset

**ContentsScreen redesign** (commit a155128, 2026-09-15):
- New sidebar layout: category filter (196px) on left, transaction table on right
- Sidebar "Filter by category" aligned with DATE column header via 86px spacer (matching search-wrap 52px + count-row 34px)
- Owner badge fixed to always top-right: Layout.jsx now uses 3-column CSS grid header
- Back button + "Transactions" title moved from ContentsScreen into Layout.jsx header for /contents route
- cs-topbar div removed from ContentsScreen
- Slim single-row SelectionBar (cs-sel-* classes) replacing old dark two-row banner
- cs-container changed from `height: 100vh` to `height: 100%`; app-content made flex column to fill correctly

**FilterPane bug fix** (commit 8e2a61d, 2026-09-12):
- Removed stale `localStorage` minimize state (`dashboardFilterPaneMinimized`) from FilterPane.jsx
- The collapse button had been removed/commented out but the localStorage read persisted, causing the pane to initialize minimized in production with no way to expand it

## Important Files for Next Session

| If touching... | Read first |
|---|---|
| Transaction table | `App/WebUI/src/screens/ContentsScreen.jsx`, `context/architecture.md` (ContentsScreen section) |
| Charts | `App/WebUI/src/utils/charts/buildStackData.jsx`, `App/WebUI/src/config/popupChartConfig.jsx` |
| Auth / permissions | `App/API/permissions.py`, `App/API/routes/auth.py` |
| Categorization | `App/API/categorise/pipeline.py` and its tiers |
| Layout / header | `App/WebUI/src/components/Layout.jsx`, `App/WebUI/src/styles/Layout.css` |
| Mobile (RN) | `App/NativeAppUI/AGENTS.md` warning first, then relevant screen/component |

## Open Work (Not Blocking)

- RN popup config wiring: `popupChartConfig.js` exists but ChartWindowSection.js has hardcoded popup — not wired
- FilterPane RN drag animation: PanResponder reorders on release, not live-animated
- COLOR_PALETTE triplicated (adminClI/adminCliCommon.py may drift from web/RN chartUtils)
- Root README.md is just a placeholder
- context/overview.html may need a milestone update for the ContentsScreen redesign

## Architecture Notes for New Sessions

See `context/architecture.md` for full detail. Key points:
- Backend: Flask + raw psycopg2, no ORM, no automated tests
- Web: React 19 + Vite, plain CSS, no TypeScript
- Web AppState = **4 split contexts** (Auth/Processing/Transactions/ChartFilter) — NOT a single AppContext
- RN AppState = **single AppContext.js** with useApp() hook
- Two sentinels: `NEEDS_MANUAL_REVIEW` (user picks) + `NOT_YET_CATEGORISED` (timed-out, retry later) — both in all 4 files
- ResponsiveGate: mobile→/home+/charts (phone mimic), desktop→/dashboard — re-evaluates live on resize
- RN popup hardcoded — popupChartConfig.js is vocabulary only, has no effect on behavior
- Auth: web = httpOnly JWT cookie; RN = expo-secure-store

## Previous Significant Sessions (Archived)

Full session write-ups are in `App/handoffFiles/01_upload-and-cache.txt` through `11_manual-review-and-optimisations.txt`. The raw chat transcript is in `App/handoffFiles/chatLog.txt` (~15,500 lines — last resort only).

Historical context that has been distilled into permanent docs:
- Architecture → `context/architecture.md`
- Engineering decisions → `context/decisions.md`
- Known bugs/debt → `context/known-problems.md`
- Failed approaches → `context/failed-solutions.md`
- Constraints → `context/constraints.md`
