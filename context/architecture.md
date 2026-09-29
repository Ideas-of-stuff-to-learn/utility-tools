<!-- last-verified: eb0073b 2026-09-23 -->
# Cashflow2.0 — Architecture

## System Layers

```
┌─────────────────────────────────────────────────┐
│  Web (React/Vite)        Mobile (Expo/RN)        │
│  tools/cashflow/WebUI/              tools/cashflow/NativeAppUI/         │
│  ─ 4 split contexts      ─ single AppContext.js  │
│  ─ react-virtual         ─ FlatList              │
│  ─ react-router-dom      ─ react-navigation      │
│  ─ httpOnly cookie auth  ─ expo-secure-store auth│
│  ─ ResponsiveGate        ─ single phone layout   │
└────────────────┬────────────────────────────────┘
                 │ REST API (fetch + httpOnly cookie / secure-store)
┌────────────────▼────────────────────────────────┐
│  Flask Backend              tools/cashflow/API/             │
│  ─ no ORM (raw psycopg2)                        │
│  ─ JWT revocation                               │
│  ─ tiered categorization pipeline               │
│  ─ Aho-Corasick + rapidfuzz + Gemini            │
└────────────────┬────────────────────────────────┘
        ┌────────┴────────┐
        ▼                 ▼
   Postgres           Gemini API
   (Supabase)         (google-genai)
```

## Backend Components

**Entry point:** `tools/cashflow/API/backend.py` — creates Flask app, registers all route blueprints
**Shared state:** `tools/cashflow/API/extensions.py` — single Flask app + JWT manager + rate limiter instance shared by all modules to avoid circular imports

**Routes:**
| File | Path | Purpose |
|---|---|---|
| `routes/auth.py` | `/api/login`, `/api/logout`, `/api/me`, `/api/refresh` | JWT cookie auth + revocation |
| `routes/transactions/upload.py` | `POST /api/upload` | Parses CSV/Excel, deduplicates by dedup_key, triggers categorization |
| `routes/transactions/crud.py` | `/api/transactions/*` | Read/delete transactions |
| `routes/transactions/categorisation_routes.py` | `/api/categorise/*` | Manual review resolution, put-in-Other endpoint |
| `routes/categories.py` | `/api/categories` | Category CRUD |
| `routes/charts.py` | `/api/charts` | Server-side aggregations (yearly/monthly rollups) |
| `routes/admin.py` | `/api/admin/*` | User/role/permission management, impersonation |
| `routes/health.py` | `/api/health` | Keep-alive ping |

**Categorization pipeline** (`tools/cashflow/API/categorise/`):
1. `exact_tier.py` — exact match against `category_records` (user's own prior categorizations)
2. `merchant_tier.py` — Aho-Corasick substring match on merchant name
3. `similarity_tier.py` — rapidfuzz fuzzy scoring
4. `llm_tier/orchestrator.py` — batched Gemini API call (tier 4, fallback)
5. Sentinel: if even Gemini can't categorize → `NEEDS_MANUAL_REVIEW = "MANUALLY CATEGORISE"` (manual fallback) or `NOT_YET_CATEGORISED = "NOT YET CATEGORISED"` (timed-out batch, will retry — never surfaced to user)

**Sentinel files (must stay in sync):**
- Canonical JS: `tools/cashflow/shared/checkingName.js`
- Web JSX: `tools/cashflow/WebUI/src/checkingName.jsx`
- RN JS: `tools/cashflow/NativeAppUI/checkingName.js`
- Python: `tools/cashflow/API/checkingName.py`

**Auth & permissions:** `tools/cashflow/API/permissions.py` — `@require_permission` decorator, role/permission lookup from DB on every authenticated request, checks `revoked_tokens` table.

**Database:** `tools/cashflow/API/database.py` — psycopg2 connection helpers. No migrations; schema changes are hand-applied to Supabase and documented in `tools/cashflow/API/schema.sql`.

## Web Frontend

**Entry:** `tools/cashflow/WebUI/src/main.jsx` → `App.jsx`

**Global State — 4 split contexts composed via AppStateProvider:**

`tools/cashflow/WebUI/src/appState/index.jsx` wraps them in this order (outer → inner):
```
AuthContext → ProcessingContext → TransactionsContext → ChartFilterContext
```

| Context | File | What it holds |
|---|---|---|
| `AuthContext` | `appState/AuthContext.jsx` | isLoggedIn, userRole, login/logout |
| `ProcessingContext` | `appState/ProcessingContext.jsx` | categorising, processingStage, manualReviewFlow. Watches for NEEDS_MANUAL_REVIEW and triggers manual review sequence. |
| `TransactionsContext` | `appState/TransactionsContext.jsx` | transactions[], categories[], categoryColors, uploadCount, uploadBreakdown. Loads from API on login. |
| `ChartFilterContext` | `appState/ChartFilterContext.jsx` | chartSummary, chartDataVersion, contentsSelectedCategories, mobileSelectedCategories, effectiveOrder (FilterPane stack order) |

**Routing — two layers:**

1. `RequiresAuth` — redirects unauthenticated users to /login
2. `ResponsiveGate` — reads `useIsMobile()` hook and routes:
   - **Mobile width** → `/home` (HomeScreen) + `/charts` (ChartsScreen) — the "phone mimic" routes
   - **Desktop width** → `/dashboard` (Dashboard)
   - Re-evaluated live on every resize — no stale orientation lock

**Screens:**

| Screen | Route | Width | Purpose |
|---|---|---|---|
| `LoginScreen.jsx` | `/login` | all | Login form |
| `SignupScreen.jsx` | `/signup` | all | Signup form |
| `Dashboard.jsx` | `/dashboard` | desktop | Charts + FilterPane sidebar + upload + stats |
| `HomeScreen.jsx` | `/home` | mobile | Upload flow + charts (mobile equivalent of Dashboard) |
| `ChartsScreen.jsx` | `/charts` | mobile | FilterPane + ChartWindowSection + ChartFootnote. Called "phone mimic" — mirrors what RN shows. |
| `ContentsScreen.jsx` | `/contents` | all | Transaction table with sidebar, virtualization, search, SelectionBar |

**Layout:** `tools/cashflow/WebUI/src/components/Layout.jsx` — 3-column CSS grid header:
- Left col: `← Dashboard` button on /contents; `Cashflow` title on /dashboard; spacer otherwise
- Center col: `Transactions` title on /contents; empty otherwise
- Right col: `<RoleBadge />` always (justify-self: end)

**Chart data flow:**
```
/api/charts ──► ChartFilterContext.chartSummary
                     │
                     ▼
            ChartFilterContext.effectiveOrder + selectedCategories
                     │
                     ▼
             buildStackData.jsx (empty set = show nothing)
                     │
                     ▼
             SpendingStackedChart ──► recharts
```

**FilterPane** (`components/dashboard/FilterPane.jsx`): category checkboxes + drag-to-reorder (HTML5 DnD on web). Used by both Dashboard (right sidebar) and ChartsScreen (inline above chart). Empty selection = chart shows nothing.

**Manual review flow:**
1. Upload completes → ProcessingContext finds NEEDS_MANUAL_REVIEW items in response
2. ManualReviewGate blocks navigation
3. ManualReviewStatsModal: stats popup, offers "Categorise Now" or "Put in Other"
4. ManualReviewSequentialModal: steps through items one by one, batches picks client-side
5. Single API call on completion (not per-item)

**Popup config** (`config/popupChartConfig.jsx`): POPUP_VARIANT (none / floatingInChart / modalInChart / belowChart) + INTERACTION_MODE. Fully wired on web — changing the config changes behavior.

## Mobile Frontend (React Native / Expo)

**Entry:** `tools/cashflow/NativeAppUI/index.js` → `App.js`

**Global State — single combined context:**
`AppContext.js` holds ALL state (auth + transactions + categories + chart data + processing + manual review) in one place. Accessed via `useApp()` hook. This is different from the web's 4-context split.

**Navigation:** react-navigation Stack.Navigator

**Key differences from web:**

| Feature | Web | RN |
|---|---|---|
| State management | 4 split contexts | Single AppContext.js + useApp() |
| List rendering | react-virtual (virtualized) | FlatList |
| Routing | react-router-dom + ResponsiveGate | react-navigation Stack |
| Chart library | recharts | react-native-gifted-charts |
| FilterPane drag | HTML5 DnD | PanResponder (reorders on release, not live-animated) |
| Category filter | Sidebar (ContentsScreen) | CategoryChipRow above FlatList |
| Auth token | httpOnly cookie | expo-secure-store |
| Popup config | Fully wired (popupChartConfig.jsx) | NOT wired (hardcoded modal in ChartWindowSection.js) |

**Screens:**
- `HomeScreen.js` — upload + charts combined (covers both Dashboard + HomeScreen web concepts)
- `ChartsScreen.js` — FilterPane + charts
- `ContentsScreen.js` — FlatList transaction table + CategoryChipRow

**Metro resolver alias:** `metro.config.js` maps `tools/cashflow/shared/` so RN can import shared JS utils by path.

**Expo warning:** Before modifying any Expo API, read `tools/cashflow/NativeAppUI/AGENTS.md` for the SDK 54 compatibility note.

## Shared Utils

`tools/cashflow/shared/` — platform-neutral JS utilities imported by both web and RN via:
- Web: standard import path
- RN: metro.config.js resolver alias

Includes: `checkingName.js` (canonical sentinel source), `buildStackData.js`, `chartUtils.js`, `chartWindowConfig.js`, `contentsUtils.js`, `homescreenUtils.js`, `monthWindow.js`, `yearWindow.js`, `yearlyChartUtils.js`.

## Upload + Data Flow

```
User selects file(s)
       │
       ▼
[Web] useFileProcessor.jsx / [RN] useFileProcessor.js
       │  POST /api/upload (multipart)
       ▼
routes/transactions/upload.py
  → parse CSV/Excel → dedup by dedup_key → INSERT new rows
  → trigger categorization pipeline per new transaction
       │
       ▼
categorise/pipeline.py — runs tiers in order, returns first match
  tier 1: exact match → category_records table
  tier 2: Aho-Corasick merchant match
  tier 3: rapidfuzz fuzzy scoring
  tier 4: Gemini LLM (batched)
  fallback: NEEDS_MANUAL_REVIEW sentinel → manual review flow
  timeout: NOT_YET_CATEGORISED sentinel → retry later (not shown to user)
       │
       ▼
Response contains results + any NEEDS_MANUAL_REVIEW items
       │
       ▼
ProcessingContext detects NEEDS_MANUAL_REVIEW → triggers manual review gate
```

## Web Boot + Data Lifecycle (cashflow, 2026-09-29)

```
main.jsx (before React renders)
  ├─ bootstrapSession()      GET /auth/me → HMAC secret, CSRF tokens, DEK (memory only)
  └─ prefetchBootSnapshot()  IDB read of the still-encrypted snapshot (last uid from localStorage)
React renders the shell immediately: status='checking', chart area = loading bars (no full-page screen)
/auth/me resolves → idbReady
  ├─ TransactionsContext: decrypt ONE snapshot → transactions+categories+upload stats in one render
  │     (no snapshot = cold start: /sync/state, then /categories + first page (500), then the rest in 2000s)
  ├─ ChartFilterContext: chartSummary = useMemo(transactions)  → chart's first frame is final
  └─ UserPreferencesContext: IDB prefs → localPrefsReady → server prefs in background
Background revalidation (boot, tab focus, every 5 min, skipped while uploading/reviewing):
  GET /sync/state fingerprints ≠ snapshot's → refetch only changed parts → swap atomically
Any data change → debounced re-encrypt + save of the snapshot (flushed before "Back to Tools")
```

Every authenticated request goes through `authorizedFetch`. It waits for the bootstrap, re-signs rather than re-refreshing after a token rotation, and recovers the refresh CSRF via `GET /auth/csrf` after a reload. It reports 429/5xx as transient, never as a logout.

## Chart Data Flow

```
[Web] TransactionsContext.transactions ──► ChartFilterContext (useMemo) ──► chartSummary
[RN]  AppContext         ──► /api/charts ──► chartSummary
       │
       ▼
FilterPane: user selects categories, drags to reorder
  (web: selection sets + chart mode/window live in ChartFilterContext → survive resize remounts)
       │
       ▼
buildStackData: filters + stacks by effectiveOrder
  (empty selectedCategories → empty chart, not show-all)
       │
       ▼
Web: StackChartCanvas (canvas 2D); RN: react-native-gifted-charts
```

## Admin Flow

`tools/cashflow/adminClI/` — standalone Python CLI scripts. `BASE_URL` in each script hardcoded to `https://cashflow2-0.onrender.com` (production). Never run against prod without intent.

Categories: colours/setColorAdmin.py, users/, permissions/

## CI/CD

GitHub Actions runs on push to main. Likely: `npm run build` (web) + deploy to Render (backend) + Expo EAS build (mobile). See `.github/workflows/` for exact steps.

## AI Development Harness (`.claude/`)

Checked into the repo. Contains:
- **Skills** (`.claude/skills/`) — slash-command recipes: `catch-up`, `build-intelligence`, `safe-point`, `task-done`, `verifier`, `realign`, `ghost-test`, `discuss`, `execute`, `execute-careful`, `ship-main`, `ship-branch`
- **Hooks** (`.claude/hooks/`) — lifecycle scripts wired via `settings.json`: session-start writes revert-state + snapshot; pre-compact writes session-snapshot; task-complete emits stats
- **Subagents** (`.claude/agents/`) — `explorer`, `librarian`, `verifier`, `context-auditor`
- **Intelligence DB** (`.ai/knowledge.db`) — SQLite index of context docs, files, constraints, decisions, failed solutions
- **Sync scripts** (`.ai/sync_context.py`, `.ai/rebuild_db.py`) — keep DB in sync with `context/*.md`
- **Plugin** — `claude-intelligence-plugin` installed via Claude Code marketplace; provides `/catch-up` and `/build-intelligence` as installable skills
