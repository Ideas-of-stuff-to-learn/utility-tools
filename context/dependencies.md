<!-- last-verified: eb0073b 2026-09-23 -->
# Cashflow2.0 — Dependencies

## Critical Dependency Chains

### Auth Token Flow
```
App/WebUI/src/api.js (fetch wrapper)
  → httpOnly JWT cookie (web)
  
App/NativeAppUI/api.jsx (fetch wrapper)
  → expo-secure-store (RN)
  
Both → Flask-JWT-Extended
  → App/API/permissions.py (@require_permission decorator)
  → App/API/routes/auth.py (refresh, revocation)
  → revoked_tokens table (Postgres)
```

### Categorization Pipeline
```
App/API/routes/uploads.py (or transactions/categorisation_routes.py)
  → App/API/categorise/pipeline.py
      → App/API/categorise/exact_tier.py
          → category_records table (Postgres)
      → App/API/categorise/merchant_tier.py
          → App/API/matching/merchants/matcher.py
              → App/API/matching/merchants/normalise.py
              → App/API/matching/merchants/storage.py
              → App/API/matching/merchants/cache_state.py
      → App/API/categorise/similarity_tier.py
          → App/API/matching/fuzzy_index.py
          → App/API/matching/similarity.py
      → App/API/categorise/llm_tier/orchestrator.py
          → App/API/matching/gemini.py (Gemini API)
          → App/API/categorise/llm_tier/batch_recheck.py
          → App/API/categorise/llm_tier/empty_result.py
      → App/shared/checkingName.js (NEEDS_MANUAL_REVIEW sentinel — JS-side)
        (Python equivalent hardcoded inline in pipeline/shared_helpers)
```

### Chart Data Flow
```
App/API/routes/charts.py
  → Postgres (aggregation queries, filtered by user_id)
  → returns JSON

App/WebUI/src/AppContext.jsx
  → useChartData hook
  → useChartWindows / useChartFilters hooks
  → App/WebUI/src/utils/charts/buildStackData.jsx
      → recharts
      → App/WebUI/src/config/popupChartConfig.jsx (popup placement)

App/NativeAppUI/AppContext.js
  → equivalent hooks
  → react-native-gifted-charts
  → App/NativeAppUI/config/popupChartConfig.js (vocabulary only — NOT wired into popup rendering)
```

### Transaction Table (Web)
```
App/WebUI/src/screens/ContentsScreen.jsx
  → App/WebUI/src/customHooks/contentsscreen/useContentsData.jsx
      → useTransactions (from AppContext)
      → useContentsData/useCategoryFilters.jsx (search/filter/sort)
      → useSelectionMode.jsx (bulk selection)
      → useCategoryResolve.jsx (category picker modal)
      → useStalenessResync.jsx (background sync)
  → @tanstack/react-virtual (virtualized rows)
  → App/WebUI/src/components/contents/
      TransactionRow, TableHeader, SelectionBar,
      StatusBanners, CategoryResolveModal
```

### NEEDS_MANUAL_REVIEW Sentinel (Triplicated)
```
App/shared/checkingName.js          ← canonical source
App/NativeAppUI/checkingName.js     ← RN duplicate
App/WebUI/src/checkingName.jsx      ← Web duplicate
```
All three must be kept in sync manually. There is no shared import mechanism between them at runtime.

### Global State → UI
```
App/WebUI/src/AppContext.jsx
  ├── transactions → ContentsScreen, ManualReview modals
  ├── categories / categoryColors → FilterPane, ContentsScreen sidebar, charts
  ├── selectedCategories (Set) → buildStackData, FilterPane
  ├── chartSummaryData → DashboardScreen, ChartsScreen
  └── auth/role → Layout (RoleBadge), permission gates

App/NativeAppUI/AppContext.js (mirrors the above for RN)
```

### Local Dev Launch Chain
```
start-all.bat
  → detect LAN IP
  → generate App/.env (backend config)
  → generate App/NativeAppUI/generatedLocalConfig.js (RN config)
  → launch backend (python App/API/backend.py)
  → launch Vite dev server (App/WebUI/)
  → launch Expo (App/NativeAppUI/)
```
Generated files (`App/.env`, `App/NativeAppUI/generatedLocalConfig.js`) must NOT be hand-edited.

### Admin CLI → Production
```
App/adminClI/*.py scripts
  → adminCliCommon.py (BASE_URL read from repo-root backend-url.json)
  → Flask admin routes (production)
  → Postgres (production)
```

### FilterPane (shared component)
```
App/WebUI/src/components/dashboard/FilterPane.jsx
  ← used by DashboardScreen (right sidebar)
  ← used by ChartsScreen (inline above chart)
  ← props: availableCategories, contentsSelectedCategories, toggleContentsCategory,
           toggleAllContentsCategories, categoryColors,
           effectiveOrder, isCustomOrder, updateOrder, resetOrder,
           persist, togglePersist

App/NativeAppUI/components/dashboard/FilterPane.js
  ← equivalent RN version (PanResponder drag, not HTML5 DnD)
```

### Category Colors
```
App/WebUI/src/utils/charts/chartUtils.jsx  (COLOR_PALETTE)
App/NativeAppUI/utils/charts/chartUtils.js (COLOR_PALETTE — RN equivalent)
App/adminClI/adminCliCommon.py             (COLOR_PALETTE — manual duplicate, may drift)
```
These three must be kept in sync manually. No runtime sharing mechanism exists.

## Key File → Responsibility Map

| File | Owns |
|---|---|
| `App/API/backend.py` | App entrypoint, route registration |
| `App/API/extensions.py` | Shared Flask/JWT/limiter instance (prevents circular imports) |
| `App/API/database.py` | DB connection helpers |
| `App/API/permissions.py` | `@require_permission` decorator, role/permission lookup |
| `App/API/cache.py` | Categorization cache tier logic |
| `App/API/schema.sql` | DB schema + inline design-decision comments |
| `App/API/categorise/pipeline.py` | Categorization tier orchestration |
| `App/WebUI/src/AppContext.jsx` | Web global state |
| `App/NativeAppUI/AppContext.js` | RN global state |
| `App/WebUI/src/utils/charts/buildStackData.jsx` | Chart segment visibility/filtering |
| `App/WebUI/src/config/popupChartConfig.jsx` | Chart popup placement + interaction mode (web, fully wired) |
| `App/NativeAppUI/config/popupChartConfig.js` | Same vocabulary for RN (NOT yet wired into popup rendering) |
| `App/WebUI/src/components/Layout.jsx` | Shell layout: 3-column header grid, app-content flex fill |
| `App/WebUI/src/screens/ContentsScreen.jsx` | Transaction table screen |
| `App/shared/checkingName.js` | NEEDS_MANUAL_REVIEW sentinel (canonical) |
| `start-all.bat` | Local dev env generation + multi-process launch |
