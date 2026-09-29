<!-- last-verified: eb0073b 2026-09-23 -->
# Cashflow2.0 — Constraints

Hard invariants. Violations cause bugs, data inconsistency, or security issues.

## UI / Layout

**Owner badge always top-right.**
Layout.jsx 3-column grid header enforces this. The `<RoleBadge />` is always the last child in the header grid and uses `justify-self: end`. Never reposition it.

**Do not read `context/overview.html` unless explicitly told to.**
It's a client-facing progress-report artifact, not coding context. Edit it only at the end of substantial tasks, when asked.

## Data / Logic

**Both sentinels must stay in sync across all 4 files.**
There are TWO sentinel constants:
- `NEEDS_MANUAL_REVIEW = "MANUALLY CATEGORISE"` — user must pick a category; surfaced in manual review flow
- `NOT_YET_CATEGORISED = "NOT YET CATEGORISED"` — timed out / not yet processed; should retry; never shown to user

Both must be identical in all 4 locations:
1. `App/shared/checkingName.js` (canonical)
2. `App/WebUI/src/checkingName.jsx`
3. `App/NativeAppUI/checkingName.js`
4. `App/API/checkingName.py`

Change all 4 or none.

**Re-upload must be a no-op.**
The `dedup_key` mechanism prevents duplicate rows. Do not break it.

**Manual review must use a single flush.**
Picks are batched client-side. One API call when the user finishes manual review. Never per-item API calls.

**Empty `selectedCategories` = show nothing.**
`buildStackData` (web and shared) must show an empty chart when the filter set is empty. Do not add a `size === 0` guard that shows all categories.

**RN popup is NOT config-driven.**
`App/NativeAppUI/config/popupChartConfig.js` exists as vocabulary/reference only. `App/NativeAppUI/components/charts/ChartWindowSection.js` has a hardcoded modal popup. Changing the config file has no effect on behavior.

## Auth / Security

**Web auth must use httpOnly cookie.**
JWT must not be accessible to JavaScript on the web side. No localStorage-based auth.

**RN auth uses expo-secure-store.**
Not cookies. Not localStorage.

## Infrastructure / Build

**Do not hand-edit generated configs.**
`App/.env` and `App/NativeAppUI/generatedLocalConfig.js` are overwritten every time the dev start script runs. Edit the templates/scripts, not the generated outputs.

**Admin CLI always targets production.**
`BASE_URL` in adminClI scripts is hardcoded to `https://cashflow2-0.onrender.com`. Run with intent. Never run bulk-delete or destructive admin operations without owner authorization.

**No automated tests.**
There is no test suite anywhere in the project. Verification is build + visual inspection only. Do not set up a test framework without explicit instruction.

**No ORM.**
Schema changes go directly to Supabase via hand-applied SQL. `App/API/schema.sql` is the source of truth. Do not introduce SQLAlchemy or any migration framework.

**No auto-merge.**
Never auto-merge PRs. The owner manually merges after testing. Do not enable auto-merge via GitHub settings or `gh` commands.

**Ghost test / verification temp files must be deleted.**
Any scratch scripts, test outputs, or debug files created during a ghost test or local verification step must be completely removed before the task is done. Never commit them or leave them in the working directory.

## AI Behavior

**Progress updates are mandatory for every task.**
After each meaningful sub-step (context read, file edit, sync, decision point), output a one-to-two line update in the chat UI with a rough percentage:
`✓ <done> [~X%]` or `→ <next> [~X%]`
Never go silent mid-task. Never front-load the full plan and then execute silently. Applies to small and large tasks equally.
For large tasks specifically: two update levels — granular sub-step updates within each major phase, **plus** a one-to-two line chunk-complete summary each time a major phase finishes.

## CSS / Layout

**Use `overflow-x: clip` not `overflow-x: hidden` on ancestors of sticky elements.**
`overflow: hidden` creates a new scroll container, which breaks `position: sticky` on any descendant — the sticky element becomes stuck relative to that new scroll container rather than the viewport. `overflow-x: clip` clips visually without creating a scroll container, so sticky children behave correctly. This applies to sidebars (cs-sidebar, charts-sidebar), filter panes, and any other sticky-positioned element. Verified on: ChartsScreen, ContentsScreen, Dashboard.

**`height: 100%` on a flex child does not reliably give a bounded height if the ancestor uses `min-height` instead of `height`.**
`min-height: 100vh` on `.app-shell` does not establish a definite height for percentage resolution of descendants. A child with `height: 100%` resolves to `auto`, breaking any internal virtualizer or scroll container that depends on a fixed height. Fix: use an explicit `height: calc(100vh - <header-height>px)` on the component that needs a bounded height, bypassing the broken chain. Verified: `.cs-container { height: calc(100vh - 48px) }` fixed `useVirtualizer` rendering all rows instead of just the visible ones.

**CSS media query breakpoints must match JS `isMobile` breakpoint.**
The JS threshold is `MOBILE_BREAKPOINT_PX = 1024` (in `src/config/breakpoints.js`). CSS mobile override blocks must use `@media (max-width: 1023px)` to match. Mismatching (e.g. 700px) causes a range where JS uses window scroll but CSS applies desktop fixed-height layout — producing broken sticky sidebars and layout glitches at intermediate widths.

## Routing

**ResponsiveGate owns the mobile/desktop routing split.**
`tools/cashflow/WebUI/src/components/ResponsiveGate.jsx` is the single place that decides mobile→/home+/charts vs desktop→/dashboard. Do not add routing logic to other components that duplicates or overrides this. It must always render `<Outlet/>` and redirect from a **passive** `useEffect`. Returning `<Navigate>` renders nothing for one commit and unmounts Layout plus every screen on each breakpoint crossing. A `useLayoutEffect` redirect is worse: BrowserRouter subscribes to history in its own layout effect, which runs after children's on first mount, so the redirect from `/` is lost and the app renders a white screen until something re-triggers it. Entry URLs (root, and `?p=` deep links handed back by landing's 404 page) are normalised by `normalizeEntryUrl()` in `main.jsx` before React renders. Keep the `KNOWN_PATHS` allowlist there in sync with the routes in `App.jsx`.

## Session / network (web)

**Every authenticated request goes through `authorizedFetch` (api.jsx).**
It waits for `bootstrapSession()` (`/auth/me`), so nothing is sent without the in-memory HMAC secret and CSRF tokens. No raw `fetch`/`sendBeacon` to authenticated endpoints, and no hydration gated on anything but `idbReady`.

**429 / 5xx / network errors are never a logout.**
Only a rejected refresh token (`isAuthFailure`) or a 401/403/422 from `/auth/me` may move auth to `unauthenticated`.

## Mobile

**Check Expo SDK 54 docs before any Expo API work.**
`App/NativeAppUI/AGENTS.md` has the warning. Any Expo API change must be verified against `docs.expo.dev/versions/v54.0.0/`.

## State Architecture

**Web AppState is 6 separate contexts, not one.**
`AuthContext`, `UserPreferencesContext`, `ProcessingContext`, `TransactionsContext`, `ChartFilterContext`, `UploadSessionContext` — composed via `AppStateProvider` in `appState/index.jsx` (nesting order documented there). Do not conflate them into a single context. State that must survive a breakpoint crossing belongs in these, not in screens.

**RN AppState is one combined context.**
`AppContext.js` with `useApp()` hook. This is intentional and mirrors how earlier RN versions were structured — it has not been split like the web.
