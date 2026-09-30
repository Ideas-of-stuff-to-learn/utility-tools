<!-- last-verified: eb0073b 2026-09-23 -->
# Cashflow2.0 — Known Problems

Issues that are documented but not yet fixed. Useful before starting work in an area.

## Web boot / session / IDB pitfalls (2026-09-29)

Read before touching `tools/cashflow/WebUI/src/api.jsx`, `appState/*`, `idb/*`, `ResponsiveGate`, or `landing/src/api.js`.

**PITFALL (fixed, do not reintroduce): any server call before `/auth/me` resolves ends the session.**
The HMAC secret and CSRF tokens live in JS memory only, so a hard page load has none. A non-`/auth/` request sent before `/auth/me` returns is rejected by the HMAC `before_request` hook (401). That triggered refresh with CSRF `"null"`, which fails, fires `auth:session-expired`, and makes cashflow redirect to landing `/login`. Landing sees valid cookies and forwards straight back: the "spinner → chart → spinner / server waking up" cycle. `authorizedFetch` now awaits `bootstrapSession()` for every path except `/auth/me`. Never add a fetch that bypasses `authorizedFetch`, and gate IDB/server hydration on `idbReady`, never on a hint.

**PITFALL (fixed): 429 / 5xx / timeouts were treated as logout.**
`AuthContext` used to clear the session on any `getMe` failure. That included Render deploy restarts, the 100/day `/auth/me` rate limit (per IP, in-memory, per worker) and HTML 429 bodies. Now only `isAuthFailure` / 401 / 403 / 422 mean "unauthenticated"; everything else retries with backoff. A JSON 429 handler exists in `extensions.py`.

**PITFALL (fixed): `csrfRefreshToken` is null after every hard load.**
So refresh after the 24h access expiry always failed, forcing a daily logout. `GET /auth/csrf` (refresh-JWT, GET so CSRF-exempt, CORS-protected) now recovers it.

**PITFALL (fixed): `ResponsiveGate` returning `<Navigate>` renders nothing for one commit.**
That unmounts `Layout` and the whole screen tree on every breakpoint crossing. It now always renders `<Outlet/>` and redirects from a layout effect. Screen state that must survive the Dashboard ↔ Home/Charts swap lives in `UploadSessionContext` / `ChartFilterContext`.

**PITFALL (fixed in hotfix): never call `navigate()` from a `useLayoutEffect` that can run on first mount.**
BrowserRouter attaches its history listener in its own layout effect, which runs after child layout effects. The URL changes but router state doesn't, so the page is white. That was the case on cashflow entry at `/` until a resize re-triggered the redirect. Use `useEffect`, like React Router's `<Navigate>`.

**PITFALL (fixed 2026-09-30): cashflow deep links are served by LANDING.**
GitHub Pages only uses the site-root `404.html`, which is landing's `index.html`. A per-folder `404.html` is ignored. So a reload, restored tab or bookmark of `/utility-tools/cashflow/dashboard` loaded the landing app with no matching route: a white screen. Landing's `main.jsx` now forwards `/utility-tools/cashflow/<path>` to `/utility-tools/cashflow/?p=<path>` before rendering, and never re-forwards a URL that already has `?p`. Cashflow's `normalizeEntryUrl()` (`ResponsiveGate.jsx`, called in `main.jsx`) restores allowlisted paths. It also rewrites the root URL to `/dashboard` or `/home` before BrowserRouter starts, so entry never depends on a post-mount redirect.

**PITFALL (fixed 2026-09-30): three separate Pages workflows raced each other.**
Landing, cashflow and admin each pushed to the same `gh-pages` branch. Two problems: (1) a shared file outside an app's folder (`backend-url.json`) triggered no deploy at all; (2) once it triggered all three, GitHub's concurrency group kept only ONE pending run, so one of the three was silently cancelled (`cancel-in-progress: false` doesn't stop a newer queued run replacing an older pending one). Now: one reusable workflow, `_publish-site.yml`, builds a site and publishes it to its own folder on `gh-pages`. If the push loses a race it re-fetches and re-applies only its own folder, up to 8 times, so parallel runs never wait or cancel (verified locally with three simultaneous publishes: real collisions, all three landed). Three thin callers (`deploy-landing/cashflow/admin.yml`) watch their own folders and have manual buttons. `deploy-all.yml` runs all three in parallel: manually, and automatically when `backend-url.json` changes (the per-site workflows deliberately don't watch it, to avoid duplicate runs). Same-site runs are serialised (`publish-<site>` group) so builds publish in commit order. Any new shared file bundled into an app must be added to `deploy-all.yml` paths.

**PITFALL (fixed 2026-09-30, unpushed): theme colour sync looped on failure.**
`useThemeSync` PATCHed every category's colour on each load when the `appliedChartTheme` flag was absent, and only set the flag on full success, so a 429 (category writes are 20/day) repeated the ~14-request burst on every load. It now diffs against the palette, sends sequentially, stops at the first failure, and won't retry within a browser session. Category colours are global, so this writes for everyone: keep it idempotent.

**Fixed after QA (2026-09-30, unpushed):** `/home` overflowed at phone width (nowrap title grew to full text width, so the JS font-fit never ran; now `max-width: 100%`); phone `/contents` columns crushed (148px sidebar + fixed columns; new ≤480px block narrows the sidebar and weights description 3 : category 2, and saved widths are now clamped to readable minimums and re-applied when preferences arrive); the category picker now closes on Escape, has a Cancel button and `role="dialog"`; Year-view total labels shrink to fit their column and there's 4px more headroom; Data Security copy spacing (JSX drops whitespace at a line break beside `<strong>`, so use `{' '}`); double scrollbars on desktop `/contents` (shell is now locked to the viewport like the dashboard; the old `calc(100vh - 89px)` undercounted chrome by ~40px).

**PENDING (needs the owner): the "Accomodation & Bills" category spelling lives in the database.** The seed in `schema.sql` now says "Accommodation & Bills", but the live category still has the old name. Because the seed is `ON CONFLICT (name) DO NOTHING`, running `schema.sql` BEFORE the rename would insert a duplicate. Run `migrations/rename_accommodation_category.sql` in the Supabase SQL editor: PART 1 renames the category in `categories`, `category_records`, `merchants` and `transactions` (skipped if already renamed); PART 2 rewrites every user's saved `stackOrder` and `mrPicks` in `users.preferences` (order preserved, idempotent). If PART 1 changed rows, restart Render (in-memory caches). Only then run schema.sql. Tested on a throwaway Postgres 17 with edge-case data (NULL/empty/non-array prefs, duplicate names, rerun, admin-panel-first): all correct. NOTE: the app's own rename (admin panel / `PATCH /categories`) never updates `users.preferences`, so after ANY category rename, users with a custom chart order lose that category from their chart; PART 2 of this script is the template for fixing that (a proper fix would put the same update inside the rename endpoint).

**Open:** page `<title>` is "webui-temp" on every route (deliberately not changed).

**Note: deploys aren't visible for up to ~10 minutes.**
GitHub Pages sends `Cache-Control: max-age=600` on `index.html`, and landing prefetches `/utility-tools/cashflow/`. Test a deploy with a hard refresh on the cashflow page itself, or after 10 minutes.

**PITFALL (fixed): per-row encrypted IDB cache.**
One AES-GCM record per transaction, with meta written only after N sequential puts, meant that navigating away mid-write left the cache stale forever. Uploads, recategorisations and deletes never reached IDB at all, and merges never removed deleted rows. Replaced by one encrypted snapshot (`idb/bootSnapshot.js`) re-saved from React state on every change.

**Open: every GitHub Pages site under `ideas-of-stuff-to-learn.github.io` shares cashflow's origin.**
Any other repo published there can call `/auth/me` with the user's cookies (CORS allows the origin) and read the DEK, CSRF and HMAC secrets, and it can read cashflow's IndexedDB/localStorage. A custom domain for the tools would close this.

**Open: `beaconResolveRemainingToOther()` (api.jsx) uses `sendBeacon`.**
It can't send HMAC/CSRF headers, so it always 401s.

**Open: the `write_queue` IDB store's rows are never deleted.**
Its only producer (`optimisticUpdateTransactions`) was dead code and has been removed, so nothing enqueues any more. `writeQueue.js` is still initialised by `api.jsx`.

**Thread-safety rules for the backend (2026-09-30, before enabling `gunicorn --threads`):**
- `database.py` uses `ThreadedConnectionPool` (minconn 3, maxconn 10). It never blocks: the 11th simultaneous `get_connection()` raises `PoolError` (a 500). Keep gunicorn `--threads` plus concurrent background saves at or below 10. The LLM tier's `_background_cache_save` thread borrows its own connection, so with `--threads 8` the worst case is exactly 10.
- psycopg2 only keeps a returned connection while fewer than `minconn` are idle, and closes the rest. With `minconn=1`, every concurrent request beyond the first opened a fresh cross-region TLS connection (~1s). Raising minconn to 3 keeps them warm.
- (Correction of an earlier entry here: the pool does roll back connections in a transaction on `putconn`, so "idle in transaction" was wrong.)
- The stale-connection retry in `extensions.check_if_token_revoked` now tries up to 3 connections, because several kept-warm idle connections can be stale at once after a long idle period.
- Shared process caches now have locks: `cache.py` (`_global_cache_lock`, one cold load) and `matching/merchants/cache_state.py` (`_cache_lock`). Loops over shared dicts iterate snapshots (`list(...)`). New shared mutable module state needs the same treatment.
- Recommended Render Start Command: `gunicorn backend:app --workers 1 --threads 8 --timeout 120`. Free tier is 0.1 CPU / 512 MB, so one worker: extra processes duplicate the caches and add no real parallelism.

**Open: rate-limit counters are `memory://` per process.**
They reset on every deploy and differ per gunicorn worker.

**Open: `tools/cashflow/WebUI/src/components/StartupScreen.jsx` is now unused.**
Cashflow never shows a full-page startup screen. Safe to delete (not deleted: it predates the session that orphaned it).

**Open (measured 2026-09-30): the backend and the database are in different regions.**
Supabase is `aws-0-eu-west-1` (Ireland), and the Render service is almost certainly US (the default is Oregon). Each DB query costs ~200 ms. A warm cashflow return visit measured 1.6 s: `/auth/me` took 1.42 s of that (vs a 215 ms `/health` round trip), while the snapshot decrypt and paint took ~0.12 s. `/auth/me` is now 2 queries instead of 6. Moved to a new Frankfurt service (`utility-tools-b6dj.onrender.com`, 2026-09-30) to cut every query to ~20 ms. The backend URL is now one file, `backend-url.json` (plus `NativeAppUI/localConfig.js`). Re-measure warm visits after the switch.

**Open: the Render backend sleeps after ~15 min idle.**
The GitHub keep-alive workflow only pings Supabase. A cold backend now shows "Still connecting…" inside the chart area instead of a full-page screen.

## Cross-cutting

**No automated tests anywhere.**
No unit, integration, or end-to-end tests exist in any part of the project (backend, web, RN). Verification is build + visual only. This is the biggest quality risk.

**Two sentinels defined in 4 files with no shared runtime import.**
`NEEDS_MANUAL_REVIEW = "MANUALLY CATEGORISE"` and `NOT_YET_CATEGORISED = "NOT YET CATEGORISED"` are each defined in:
- `App/shared/checkingName.js` (canonical JS)
- `App/WebUI/src/checkingName.jsx`
- `App/NativeAppUI/checkingName.js`
- `App/API/checkingName.py`

The Python backend can't import JS. The RN metro config aliases `App/shared/` but that alias must be maintained. If any of the 4 files drifts, categorization logic silently breaks across platforms.

**`COLOR_PALETTE` triplicated.**
`App/WebUI/src/utils/charts/chartUtils.jsx`, `App/NativeAppUI/utils/charts/chartUtils.js`, and `App/adminClI/colours/setColorAdmin.py` each define or reference the color list independently. If a category color changes in one, it won't match the others.

## Web

**Web AppState often misdocumented as monolithic.**
New sessions or tools sometimes incorrectly document the state as a single `AppContext.jsx`. It is 4 separate contexts: `AuthContext`, `ProcessingContext`, `TransactionsContext`, `ChartFilterContext`.

**sendBeacon gap on tab close.**
If the user closes the browser tab while categorization is still in progress (in-flight batch not flushed), those picks are lost. Only fully-staged items survive. Mitigation is complex; flagged for awareness.

## Mobile (RN)

**RN popup not config-driven.**
`App/NativeAppUI/config/popupChartConfig.js` is vocabulary-only. `ChartWindowSection.js` has a hardcoded modal popup. Changing the config has no visible effect. The web version is fully wired; RN is not.

**FilterPane drag has no live animation.**
RN FilterPane uses PanResponder. Items reorder on finger release, not animated live under the finger. HTML5 DnD on web has smoother behavior. Low priority, cosmetic.

**RN ContentsScreen uses FlatList.**
`ContentsScreen.js` uses FlatList with `CategoryChipRow` (chips above the list) rather than a virtualized sidebar layout like the web version. For very large transaction lists, this may be slower.

## Backend / Admin

**AdminCLI hardcoded to production.**
`BASE_URL` in the admin CLI scripts always points to the production URL in `backend-url.json`. There is no dev/staging mode. Running any admin script hits the live database.

**No ORM, no migration system.**
Schema changes are hand-applied to Supabase. `schema.sql` is the human-maintained record. There are no rollbacks.

**Scratch CSVs in API dir.**
Test/scratch CSV files may exist in `App/API/`. They are gitignored (`*.csv`) but could confuse file explorers.

## Docs

**Root README is a placeholder.**
`README.md` at the repo root contains only `# Cashflow2.0`. Anyone landing on the GitHub page sees nothing useful.
