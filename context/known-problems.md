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

**PITFALL (fixed): per-row encrypted IDB cache.**
One AES-GCM record per transaction, with meta written only after N sequential puts, meant that navigating away mid-write left the cache stale forever. Uploads, recategorisations and deletes never reached IDB at all, and merges never removed deleted rows. Replaced by one encrypted snapshot (`idb/bootSnapshot.js`) re-saved from React state on every change.

**Open: every GitHub Pages site under `ideas-of-stuff-to-learn.github.io` shares cashflow's origin.**
Any other repo published there can call `/auth/me` with the user's cookies (CORS allows the origin) and read the DEK, CSRF and HMAC secrets, and it can read cashflow's IndexedDB/localStorage. A custom domain for the tools would close this.

**Open: `beaconResolveRemainingToOther()` (api.jsx) uses `sendBeacon`.**
It can't send HMAC/CSRF headers, so it always 401s.

**Open: the `write_queue` IDB store's rows are never deleted.**
Its only producer (`optimisticUpdateTransactions`) was dead code and has been removed, so nothing enqueues any more. `writeQueue.js` is still initialised by `api.jsx`.

**Open: `release_connection()` returns connections without rollback.**
Connections go back to the pool "idle in transaction". `SimpleConnectionPool` is also not thread-safe under threaded gunicorn workers.

**Open: rate-limit counters are `memory://` per process.**
They reset on every deploy and differ per gunicorn worker.

**Open: `tools/cashflow/WebUI/src/components/StartupScreen.jsx` is now unused.**
Cashflow never shows a full-page startup screen. Safe to delete (not deleted: it predates the session that orphaned it).

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
`BASE_URL` in the admin CLI scripts always points to `https://cashflow2-0.onrender.com`. There is no dev/staging mode. Running any admin script hits the live database.

**No ORM, no migration system.**
Schema changes are hand-applied to Supabase. `schema.sql` is the human-maintained record. There are no rollbacks.

**Scratch CSVs in API dir.**
Test/scratch CSV files may exist in `App/API/`. They are gitignored (`*.csv`) but could confuse file explorers.

## Docs

**Root README is a placeholder.**
`README.md` at the repo root contains only `# Cashflow2.0`. Anyone landing on the GitHub page sees nothing useful.
