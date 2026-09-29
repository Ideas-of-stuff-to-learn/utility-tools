<!-- last-verified: eb0073b 2026-09-23 -->
# Cashflow2.0 — Failed Solutions

## Cashflow return-visit spinner / "server waking up" cycle (2026-09-29)

The root cause was NOT in TransactionsContext. `UserPreferencesContext` (gated on the sessionStorage hint) sent `GET /preferences` before `/auth/me` returned. The HMAC hook 401'd it, the refresh went out with CSRF `"null"`, `auth:session-expired` fired, and the app bounced through landing `/login` and back. The spinner and "waking up" page the user saw were mostly landing's login checking screen. Fixed in the boot overhaul (session gate in `authorizedFetch`).

**Attempt 1 (c4709fa):** gate the TransactionsContext effect on `idbReady`.
**Why it failed:** it fixed a real double-run but left the pre-`getMe` `/preferences` call, which caused the bounce.

**Attempt 2:** call `endSession()` before the "Back to Tools" hard nav.
**Why it failed:** `isLoggedIn=false` made RequireAuth fire its own login redirect, and landing forwarded straight back to cashflow instead of staying on the landing page. Reverted.

**Attempt 3 (6f27897):** longer TTLs plus `setMeta` for categories on the per-row IDB cache.
**Why it failed:** meta was written only after N sequential encrypted puts, and mutations never reached IDB, so repeat visits never got faster. Replaced by the single-record snapshot.

**Attempt 4 (afa10f0):** `primeGetMe()` preflight at module load.
**Why it failed:** a small latency win, but it did nothing about the pre-`getMe` 401. Superseded by `bootstrapSession()` plus the session gate.

**Attempt 5 (afa10f0, reverted in 6f05b58):** remove `LoadingBarsPlaceholder` from the chart area.
**Why it failed:** the owner wants the animated bars. Only the full-page StartupScreen and the "waking up" banner/page were unwanted.

**Lesson:** trace the whole request timeline, including every provider's mount effects and the landing app's redirect behaviour, before patching the component where the symptom shows.

**Regression in the fix (b8de3dc):** ResponsiveGate redirected from a `useLayoutEffect`, meant to keep Layout mounted and avoid a one-frame wrong screen.
**Result:** a white screen on every cashflow entry at `/` until the user resized. On first mount the child layout effect ran before BrowserRouter subscribed to history, so the redirect updated the URL but not router state.
**Fix:** `useEffect`. The browser probe during verification had shown `/home` with empty body text, and it was misread as a transient. An empty-body probe on first load is a bug signal, not noise.

## JWT Authentication

**Attempt:** Initial JWT implementation without token revocation.  
**Result:** Logging out did not invalidate the token — users could still make authenticated requests with a "logged out" token.  
**Why it failed:** JWTs are stateless; without server-side revocation checking, there is no way to invalidate an issued token before its expiry.  
**Fix:** Added `revoked_tokens` table; `@require_permission` now checks it on every request.  
**Relevant files:** `App/API/routes/auth.py`, `App/API/permissions.py`, `App/API/schema.sql`  
**Session:** handoffFiles/05_jwt-problem.txt, 06_jwt-fix.txt

## Chart Filter Empty-Set Behavior

**Attempt:** Treating an empty `selectedCategories` set as "show all categories."  
**Result:** Deselecting all categories showed every bar instead of nothing.  
**Why it failed:** The original filter logic used `size === 0` as a special "no filter applied" state, but the checkbox UI model treats deselecting all as "nothing selected = nothing shown." These two semantics conflict.  
**Fix:** Removed the `size === 0` guard in `buildStackData.jsx`; empty set now means nothing visible.  
**Relevant files:** `App/WebUI/src/utils/charts/buildStackData.jsx`  
**Session:** handoffFiles/11_manual-review-and-optimisations.txt  
**Lesson:** Don't conflate "no filter" with "empty filter" — the UI must define which it is, and the rendering must match.

## Manual Review: Per-Item API Calls

**Attempt:** Sending one API call per transaction pick during manual review.  
**Result:** Slow, and partial-state risk if the user closed the tab mid-review (some picks applied, some not).  
**Why it failed:** N picks = N round trips = visible latency + no atomicity.  
**Fix:** Batch picks client-side in a ref array; flush as a single API call on review completion.  
**Relevant files:** `App/WebUI/src/components/homepage/manualReview/`, `App/API/routes/transactions/categorisation_routes.py`  
**Session:** handoffFiles/11_manual-review-and-optimisations.txt

## "Put in Other": Per-Item Loop

**Attempt:** Backend handling "put all unreviewed in Other" via a per-row loop.  
**Result:** O(n) round trips or O(n) SQL updates, slow for large transaction sets.  
**Fix:** Single `UPDATE transactions SET category = 'Other' WHERE user_id = ? AND category = NEEDS_MANUAL_REVIEW`.  
**Relevant files:** `App/API/routes/transactions/categorisation_routes.py`  
**Session:** handoffFiles/11_manual-review-and-optimisations.txt

## CSS: overflow-x: auto + overflow-y: visible Interaction

**Attempt:** Setting `overflow-x: auto` on a container while leaving `overflow-y: visible` to allow content to spill vertically.  
**Result:** An unwanted second vertical scrollbar appeared inside the Dashboard layout.  
**Why it failed:** CSS spec: setting either overflow axis to any value other than `visible` forces the other axis to `auto` if it was `visible`. So `overflow-x: auto` silently makes `overflow-y: auto` too, even if not specified.  
**Fix:** Restructured the Dashboard layout so each legitimate scroll region is explicitly defined, with no nested conflicting overflow axes.  
**Relevant files:** `App/WebUI/src/styles/` (Dashboard-related CSS)  
**Lesson:** Never pair `overflow-x: auto` with the expectation that `overflow-y` stays `visible`. They cannot coexist.

## FilterPane: Two Separate Lists (Categories + Stack Order)

**Attempt:** Maintaining separate "Categories" checkbox list and "Stack order" up/down-button list as independent components.  
**Result:** Duplicated state, duplicated props, and the UI showed two redundant lists of the same categories.  
**Fix:** Merged into a single `FilterPane` component — each row is a checkbox + colour dot + drag handle.  
**Relevant files:** `App/WebUI/src/components/dashboard/FilterPane.jsx`  
**Session:** Recent dashboard/charts space-optimization pass.

## LocalStorage Minimize State for FilterPane

**Attempt:** Persisting FilterPane minimize state in `localStorage` under key `dashboardFilterPaneMinimized`.  
**Result:** After the collapse button was removed (commented out), the `localStorage` key remained `true` from previous sessions. On load, the pane initialized minimized with no UI to expand it — effectively invisible in production.  
**Fix:** Removed the entire minimize state and `localStorage` persistence from `FilterPane.jsx`. The pane is now always fully expanded.  
**Relevant files:** `App/WebUI/src/components/dashboard/FilterPane.jsx`  
**Lesson:** When removing a UI control, always remove its associated state persistence too. Stale `localStorage` keys survive across sessions and can cause invisible state corruption.

## ContentsScreen: Two Stacked Headers

**Attempt:** Adding a `cs-topbar` div inside `ContentsScreen` for the back button + page title, while `Layout.jsx` still rendered its own `app-header` above it.  
**Result:** Two header bars stacked on the contents page; Owner badge appeared top-left instead of top-right (no left-side element in the Layout header to push it right).  
**Fix:** Moved back button + page title into `Layout.jsx` header for the `/contents` route; removed `cs-topbar` from `ContentsScreen`. Layout now uses a 3-column grid: left slot / center title / right Owner badge.  
**Relevant files:** `App/WebUI/src/components/Layout.jsx`, `App/WebUI/src/styles/Layout.css`, `App/WebUI/src/screens/ContentsScreen.jsx`
