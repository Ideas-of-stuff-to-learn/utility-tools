# Cashflow 2.0 — Task Backlog

> **Status key:** `[ ]` open &nbsp;·&nbsp; `[-]` in progress &nbsp;·&nbsp; `[x]` done &nbsp;·&nbsp; `[~]` blocked  
> **Priority key:** 🔴 P1 Critical &nbsp;·&nbsp; 🟠 P2 High &nbsp;·&nbsp; 🟡 P3 Medium &nbsp;·&nbsp; 🟢 P4 Low

---

## 🎯 Target & Progress Log

**Deadline:** 30 September 2026 — aim to have all P1 and P2 tasks complete, P3 in progress or done, P4 scoped.  
**Check-in cadence:** every 5 days — write a short progress note below.

| Check-in | Date | Notes |
|----------|------|-------|
| 1 | 22 Sep 2026 | Ahead of schedule. Full auth system shipped (email verification, forgot/reset password, profile UI, soft-delete + 48h grace, account deletion email flow). Landing page live. Admin panel built (standalone Vite app, GitHub Pages). Roles/permissions/users management, impersonation log, category management all in admin panel. Task 2 ✓, Task 17 ✓, most of Task 21 ✓. |
| 2 | 27 Sep 2026 | _(write update here)_ |
| 3 | 02 Oct 2026 | _(extended if needed)_ |

> The deadline is an aim, not a hard constraint — extend if needed but keep the cadence.

---

## Quick Reference

| # | Task | Priority | Effort | Complexity |
|---|------|----------|--------|------------|
| [1](#1--isolate-auth-into-shared-auth--billing-service) | Isolate auth into shared service | 🔴 P1 | 2–3 weeks | Very High |
| [2](#2--company-landing-page) | Company landing page | 🔴 P1 | 3–5 days | Medium |
| [22](#22--admin-panel-security-hardening) | Admin panel security hardening | 🔴 P1 | 1–2 weeks | High |
| [3](#3--stripe-billing-integration) | Stripe billing integration | 🔴 P1 | 1–2 weeks | High |
| [4](#4--webhook-listener-subscription-status-sync) | Webhook listener (subscription sync) | 🔴 P1 | 3–5 days | High |
| [5](#5--per-tool-jwt-access-gating) | Per-tool JWT access gating | 🟠 P2 | 3–5 days | High |
| [23](#23--role-creation-level-ceiling) | Role creation level-ceiling | 🟠 P2 | 0.5–1 day | Low |
| [24](#24--role-level-auto-calculation-from-permissions) | Role level auto-calculation from permissions | 🟠 P2 | 1–2 days | Medium |
| [25](#25--indexeddb-client-storage-layer) | IndexedDB client storage layer | 🟠 P2 | 1–2 weeks | High |
| [6](#6--deployed-subdomain-linkage) | Deployed subdomain linkage | 🟠 P2 | 2–3 days | Medium |
| [7](#7--free-trial-support) | Free trial support | 🟠 P2 | 2–3 days | Medium |
| [8](#8--stripe-customer-portal-self-service) | Stripe Customer Portal (self-service) | 🟠 P2 | 1–2 days | Low |
| [9](#9--category-list-vanishing-on-remember-this-order) | ~~Category list vanishing bug~~ | 🟠 P2 | 0.5–1 day | Low |
| [10](#10--bring-react-native-up-to-date) | Bring React Native up to date | 🟠 P2 | 3–5 days | Medium |
| [11](#11--dashboard-zero-page-scroll) | ~~Dashboard: no page scroll~~ | 🟡 P3 | 0.5–1 day | Low |
| [12](#12--convert-footnote-box--user-information-popup) | ~~User Information popup~~ | 🟡 P3 | 1–2 days | Low |
| [13](#13--add-data-security-popup) | ~~Data Security popup~~ | 🟡 P3 | 1 day | Low |
| [14](#14--font-size-and-colour-palette-audit) | ~~Font, size and colour palette audit~~ | 🟡 P3 | 2–3 days | Medium |
| [15](#15--hard-testing--all-surfaces) | Hard testing (all surfaces) | 🟡 P3 | 3–5 days | Medium |
| [16](#16--full-automated-test-suite) | Full automated test suite | 🟢 P4 | 2–4 weeks | Very High |
| [17](#17--owner-admin-page) | ~~Owner admin page (CLI + SQL tools in UI)~~ | 🟢 P4 | 2–3 days | Medium |
| [18](#18--migrate-github-pages-deployment-to-private-repo--alternative-host) | Migrate GitHub Pages to private repo + new host | 🟢 P4 | 1–2 days | Medium |
| [19](#19--filter-pane-no-scroll--fully-visible) | ~~Filter pane: no scroll, always fully visible~~ | 🟡 P3 | 0.5 day | Low |
| [20](#20--rename-app-title-to-personal-spending-pattern-visualisation-tool) | ~~Rename app title to "Personal Spending…"~~ | 🟡 P3 | 0.5 day | Low |
| [21](#21--auth-service-oauth--security-controls) | Auth service: OAuth providers + security controls | 🟠 P2 | 1–2 weeks | High |

---

## 🔴 P1 — Critical (Do First · These Block Everything Else)

---

### 1 · Isolate auth into shared Auth & Billing Service

**Priority:** 🔴 P1 — Critical  
**Effort:** 2–3 weeks  
**Complexity:** Very High  
**Why first:** Every other task in this section depends on a single identity layer existing. Cashflow's current auth (login, signup, auto-login, JWT, bcrypt, refresh, revocation) needs to be extracted and deployed as a standalone service that any future tool can point at.

**What it involves:**
- Extract login, signup, logout, refresh, and `/auth/me` out of Cashflow's Flask backend into a new standalone service (new repo or clearly isolated sub-service)
- New shared `users` table with: unique ID, email, username, bcrypt-hashed password
- JWT issuance updated to include a `tools` claim — a list of tool IDs the user has active access to (starts with `["cashflow"]` for existing users)
- Auto-login (silent re-auth on page load via refresh token) must continue to work post-extraction
- Cashflow's backend stops owning auth — all auth routes delegate to, or are removed in favour of, the shared service
- Decide: keep rolling own auth (current approach, works fine) vs. move to managed provider (Supabase Auth / Clerk) — spec recommends own at this scale
- CORS, cookie domain, and cross-origin session strategy agreed before build

**What it touches:**  
`App/API/routes/auth.py` · `App/API/routes/preferences.py` · `App/WebUI/src/appState/AuthContext.jsx` · `App/WebUI/src/api.jsx` · `App/API/schema.sql` · `App/API/backend.py` · all JWT-dependent routes · deployment config on Render

---

### 2 · Company landing page

**Priority:** 🔴 P1 — Critical  
**Effort:** 3–5 days  
**Complexity:** Medium  
**Why first:** The shared service needs a home. This is the public-facing page users land on, see the product line, and are directed to login/subscribe. Must exist before subdomain linkage and Stripe flow can be tested end-to-end.

**What it involves:**
- Standalone site (separate from Cashflow) listing the company's tools with descriptions and subscribe/login CTAs
- Links to each deployed tool (initially just Cashflow)
- Login/signup redirects to the shared auth service, then back to the chosen tool
- Design consistent with the overall brand
- Deployed independently (its own Render service or static host)

**What it touches:**  
New repo / new deployment · shared auth service (redirect URLs) · Stripe Checkout URLs per tool

---

### 3 · Stripe billing integration

**Priority:** 🔴 P1 — Critical  
**Effort:** 1–2 weeks  
**Complexity:** High  
**Why first:** No money flows, no subscriptions exist, and the access-gating in task 5 has nothing to check until this is done. Needs to be live before any paying users can be onboarded.

**What it involves:**
- Create one Stripe account for the company
- Create one Stripe Product + Price per tool (e.g. "Cashflow 2.0 — Monthly")
- Add a `subscriptions` table to the shared service DB: `(user_id, tool_id, stripe_subscription_id, status, current_period_end)`
- Implement Stripe Checkout session creation endpoint — called when user clicks "Subscribe" on a tool page
- After successful payment, Stripe fires webhook → task 4 handles it
- Stripe Customer Portal link for self-service management (task 8)
- Decide trial policy (task 7) before build — affects Checkout config
- Test full payment loop in Stripe test mode before going live

**What it touches:**  
New shared service: `routes/billing.py` (or equivalent) · `schema.sql` (subscriptions table) · Stripe dashboard · environment variables (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) · Render deployment config

---

### 4 · Webhook listener (subscription status sync)

**Priority:** 🔴 P1 — Critical  
**Effort:** 3–5 days  
**Complexity:** High  
**Why first:** Without this, Stripe payments succeed but nothing in the system knows about it. The webhook listener is the bridge between Stripe and the access layer — it must exist before any end-to-end payment test is possible.

**What it involves:**
- One POST endpoint on the shared service that receives all Stripe webhook events
- Verify webhook signature (`stripe.Webhook.construct_event`) before processing — security critical
- Handle events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- On each event: update `subscriptions` table status and `current_period_end`
- Treat `trialing` the same as `active` (see task 7)
- Register endpoint in Stripe dashboard; use Stripe CLI locally to replay events during development
- Log unhandled event types but do not error — Stripe sends many event types

**What it touches:**  
Shared service: `routes/webhooks.py` · `subscriptions` table · Stripe dashboard webhook config · environment secrets

---

## 🟠 P2 — High (Build After Foundation Is Live)

---

### 5 · Per-tool JWT access gating

**Priority:** 🟠 P2 — High  
**Effort:** 3–5 days  
**Complexity:** High  
**Why:** Once auth is isolated and billing exists, each tool needs to gate its features based on whether the user has an active subscription for that tool. This is the mechanism that makes the whole architecture pay off.

**What it involves:**
- Update JWT payload on login/refresh to include `"tools": ["cashflow", ...]` — the list of tool IDs with active/trialing subscriptions for that user
- Cashflow's backend verifies the token and checks `"cashflow"` is in the `tools` claim before serving protected routes
- If not subscribed: return a 402 or redirect to the Stripe Checkout for Cashflow's product
- Frontend shows "Subscribe" CTA rather than the app when access is denied
- Existing Cashflow users need their subscriptions seeded — decide: grandfather them in free, or require them to subscribe

**What it touches:**  
Shared auth service: JWT issuance · `App/API/` JWT verification middleware · `App/WebUI/src/appState/AuthContext.jsx` · `App/WebUI/src/components/RequiresAuth.jsx` · all protected routes

---

### 6 · Deployed subdomain linkage

**Priority:** 🟠 P2 — High  
**Effort:** 2–3 days  
**Complexity:** Medium  
**Why:** Getting the cookie and redirect flow working across subdomains is a prerequisite to testing the real user journey. Easiest if all tools sit under one parent domain so a single cookie scoped to `.company.com` is readable everywhere.

**What it involves:**
- Register company domain (if not done)
- Set up subdomains: `app.company.com` (Cashflow), `tools.company.com` (landing page), `auth.company.com` (shared service)
- Configure JWT cookies with `Domain=.company.com` so they're shared across subdomains
- Update all CORS, `FRONTEND_URL`, and redirect config on Render for each service
- Test full login-on-landing-page → redirect-to-tool → token-present flow

**What it touches:**  
Render deployment config for all services · DNS / domain registrar · `App/API/backend.py` (cookie domain, CORS) · environment variables

---

### 7 · Free trial support

**Priority:** 🟠 P2 — High  
**Effort:** 2–3 days  
**Complexity:** Medium  
**Why:** Agreed as part of the architecture. Must be decided and built before Cashflow goes to paying users — retrofitting trial logic after real subscriptions exist is messier.

**What it involves:**
- Decide trial length and card-required policy (business decision, not technical — agree before build)
- Pass `trial_period_days` to Stripe Checkout session creation when creating a subscription
- Update webhook handler and subscriptions table to treat `trialing` as `active`
- Optional abuse guard: one trial per verified email (low priority for soft launch but flag for later)

**What it touches:**  
Shared service: Checkout session creation · webhook handler · subscriptions table status logic

---

### 8 · Stripe Customer Portal (self-service)

**Priority:** 🟠 P2 — High  
**Effort:** 1–2 days  
**Complexity:** Low  
**Why:** Without this, users cannot update their card, switch plans, or cancel — everything would need to be handled manually. Stripe provides this for free; it just needs enabling and linking.

**What it involves:**
- Enable Stripe Customer Portal in Stripe dashboard (configure what users can do: cancel, update card, switch plan)
- Add one endpoint to shared service: creates a Stripe portal session and redirects the user there
- Add "Manage subscription" link in Cashflow's account/settings UI
- Portal redirects back to the tool when done

**What it touches:**  
Stripe dashboard · shared service: `routes/billing.py` · Cashflow frontend: account/settings area

---

### 9 · Category list vanishing on "Remember this order"

**Status:** `[x]` Done — 2026-09-17

**Root cause:** `useStackOrder` hydration effect filtered `savedOrder` against `categoryNames` at mount time. `categoryNames` is `[]` on mount (async fetch), so the filter produced `[]` permanently — `effectiveOrder` was always empty after a reload with persist=true. Fix: hydration now sets raw `savedOrder` directly; `effectiveOrder` filters reactively on every render. Also gated both "Remember this order" and "Reset to default" on `isCustomOrder` so neither appears on the default order.

---

### 10 · Bring React Native up to date

**Priority:** 🟠 P2 — High  
**Effort:** 3–5 days  
**Complexity:** Medium  
**Why:** RN is currently behind and untested. Needed before any meaningful mobile testing and before the shared-auth changes (task 1) affect the mobile login flow.

**What it involves:**
- Review all dependencies against Expo SDK 54 docs (`docs.expo.dev/versions/v54.0.0/`)
- Update packages, resolve breaking API changes
- Verify iOS and Android builds are clean
- Check login/logout, upload, charts, and manual review flows still work end-to-end

**What it touches:**  
`App/NativeAppUI/` · `package.json` · Expo config · any Expo API calls (check `App/NativeAppUI/AGENTS.md` warnings)

---

## 🟡 P3 — Medium (Polish · Do After Core Platform Is Stable)

---

### ~~11 · Dashboard: zero page scroll~~ ✅

**Priority:** 🟡 P3 — Medium  
**Effort:** 0.5–1 day  
**Complexity:** Low  
**Why:** The dashboard should be a single contained screen. Page-level scroll breaks the fixed-height layout and looks unfinished. Includes the legal footer not pushing content outside the viewport.

**What it involves:**
- Audit all elements on the dashboard that could contribute to overflow
- Apply explicit `height` constraints so the layout is fully contained within `100vh`
- Ensure the legal footer sits inside the layout rather than extending the page
- Verify on both desktop and phone mimic

**What it touches:**  
`App/WebUI/src/screens/Dashboard.jsx` · dashboard CSS · `App/WebUI/src/components/Layout.jsx` · `Layout.css`

---

### ~~12 · Convert footnote box → "User Information" popup~~ ✅

**Priority:** 🟡 P3 — Medium  
**Effort:** 1–2 days  
**Complexity:** Low  
**Why:** The current footnote box is visually cluttered and takes up permanent space. A popup modal is cleaner, more prominent, and consistent with the ℹ pattern already used on the Transactions page.

**What it involves:**
- Remove the existing footnote box from the dashboard
- Add a prominent `ℹ` icon button to the dashboard header/UI
- Clicking it opens a modal labelled "User Information" with the same content
- Modal also surfaces links to the four legal pages (Privacy, Terms, Accessibility, Cookies)
- Style consistent with the existing Transactions info modal

**What it touches:**  
`App/WebUI/src/screens/Dashboard.jsx` · dashboard CSS · `App/WebUI/src/styles/chartFootnote.css` (removed) · `Layout.jsx` pattern reference

---

### ~~13 · Add "Data Security" popup~~ ✅

**Priority:** 🟡 P3 — Medium  
**Effort:** 1 day  
**Complexity:** Low  
**Why:** Users deserve easy access to the security explainer from within the app. Pairs naturally with the User Information popup (task 12) and uses the already-written `docs/data-security.html` content.

**What it involves:**
- Add a 🔒 lock icon button to the dashboard (near the ℹ button)
- Clicking it opens a modal whose content is drawn from `docs/data-security.html`
- The modal content should be editable by the client without a code change — consider either rendering the HTML file inline or linking to it
- Popup also links to the legal pages

**What it touches:**  
`App/WebUI/src/screens/Dashboard.jsx` · dashboard CSS · `docs/data-security.html`

---

### 14 · Font, size and colour palette audit

**Priority:** 🟡 P3 — Medium  
**Effort:** 2–3 days  
**Complexity:** Medium  
**Why:** Three surfaces (web dashboard, phone mimic, React Native) have diverged over time. Inconsistency looks unpolished and erodes trust, especially as the platform expands to multiple tools.

**What it involves:**
- Document every font family, size, weight, and colour in use across all three surfaces
- Identify mismatches — particularly between the phone mimic (web) and actual React Native
- Agree a single token set as source of truth
- Apply corrections and verify on all three surfaces

**What it touches:**  
`App/WebUI/src/styles/` · `App/NativeAppUI/` styles · phone mimic CSS · potentially a new shared tokens file

---

### 15 · Hard testing — all surfaces

**Priority:** 🟡 P3 — Medium  
**Effort:** 3–5 days  
**Complexity:** Medium  
**Why:** Pre-launch confidence pass. Should happen after the popup work (tasks 12, 13), React Native update (task 10), and dashboard scroll fix (task 11) are complete.

**What it involves:**
- Web dashboard: golden path end-to-end (upload → categorise → manual review → charts)
- Known fragile areas: virtualiser performance, column resize persistence, manual review flush, preferences sync, cold-start spinner
- Phone mimic: full flow at mobile width, all popups, legal pages, back navigation
- React Native: login, upload, charts, manual review, edge cases (empty state, offline, large file)
- Document any failures as new tasks

**What it touches:**  
All surfaces · no code changes expected — this is verification only

---

## 🟢 P4 — Low (Future · Requires Scoping Before Work Begins)

---

### 16 · Full automated test suite

**Priority:** 🟢 P4 — Low  
**Effort:** 2–4 weeks  
**Complexity:** Very High  
**Why last:** No test framework currently exists. This is a significant scoping and tooling decision before a single test is written. Wrong choices here are expensive to undo.

> ⚠️ **Requires explicit owner sign-off on scope before any code is written.**  
> See `context/constraints.md` — no test framework should be introduced without instruction.

**What it involves:**
- Scoping session: agree on unit vs. integration vs. E2E, and which surfaces (web only, RN, API)
- Choose tooling: e.g. Vitest/React Testing Library (web unit), Playwright (E2E web), Detox (RN)
- Agree what "passing suite" means and what CI triggers it
- Write tests progressively: start with the categorisation pipeline and auth routes (highest risk), then UI flows
- Set up CI to run on push to main

**What it touches:**  
Everything — this is a cross-cutting concern across `App/API/`, `App/WebUI/`, and `App/NativeAppUI/`

---

---

## ~~17 — Owner admin page~~ ✅

**Status:** `[x]` Done — 2026-09-23 &nbsp;·&nbsp; **Priority:** 🟢 P4 &nbsp;·&nbsp; **Effort:** 2–3 days &nbsp;·&nbsp; **Complexity:** Medium

A protected web UI page (`/admin`) visible only to the `owner` role (or a configurable high-permission role). Consolidates the admin CLI tools and the test SQL utilities into a point-and-click interface so there's no need to open a DB client or terminal for common owner tasks.

**Scope:**
- Route gated by `role = 'owner'` (or role_id threshold) — non-owners get 404 or redirect
- Sections to include:
  - **Manual review tester** — the `_mr_test_backup` query wrapped in a form: set `n`, pick source categories from a multi-select, flip/restore with one click; shows a table of what changed
  - **Category management** — view/rename/merge categories (currently adminCLI-only)
  - **User management** — view users, toggle roles (owner-only)
  - **DB health** — row counts per table, cache status, last categorisation run
- The existing `App/API/adminCLI/` logic should be extracted into reusable backend route functions that both the CLI and the admin page call — no duplication
- `_mr_test_backup` table must exist (one-time migration in `schema.sql`)

**What it touches:**
`App/API/routes/` (new `admin.py`), `App/WebUI/src/screens/` (new `AdminScreen.jsx`), `App/WebUI/src/components/Layout.jsx` (conditional nav link), `App/API/adminCLI/` (refactor shared logic out)

---

---

## 18 — Migrate GitHub Pages deployment to private repo + alternative host

**Status:** `[ ]` &nbsp;·&nbsp; **Priority:** 🟢 P4 &nbsp;·&nbsp; **Effort:** 1–2 days &nbsp;·&nbsp; **Complexity:** Medium

Currently `context/overview.html` (and any other public-facing docs) are served via GitHub Pages from this public repo. As the project matures, the repo should transition to private and Pages will stop working. This task scopes what that migration looks like and what else it breaks.

**What it involves:**
- Decide on a replacement host: Render static site, Netlify, Cloudflare Pages, or another service — must support private-source deploys
- Audit everything that currently depends on the GitHub Pages URL (any links in code, docs, emails, the landing page, or external references) and update them to the new URL
- Wire up the new deployment: connect the private repo to the chosen host, set up the deploy trigger (push to main or a dedicated `docs` branch)
- Update the repo visibility from public → private once the new deploy is live and verified
- Check downstream effects:
  - `context/overview.html` links still resolve
  - Any `CNAME` or custom domain config carries over
  - GitHub free-tier limits — private repos with GitHub Actions minutes, LFS, etc.
  - Any CI/CD workflows that reference `github.com/<org>/<repo>` public URLs
- Update `context/gitContext.md` and `context/overview.html` with the new deploy URL and workflow

**What it touches:**  
Repo visibility settings · GitHub Pages config · `context/gitContext.md` · `context/overview.html` · any hardcoded public GitHub URLs in docs or code · chosen external static host config

---

## ~~19 — Filter pane: no scroll, always fully visible~~ ✅

**Status:** `[x]` Done — 2026-09-20 &nbsp;·&nbsp; **Priority:** 🟡 P3 &nbsp;·&nbsp; **Effort:** 0.5 day &nbsp;·&nbsp; **Complexity:** Low

The filter pane currently has `overflow-y: auto` and `.filter-pane-scroll-list` is capped at `max-height: 280px`, which means when there are many categories the list scrolls internally. The goal is to remove all scrolling from the pane — it should always show every category at once and still bottom-align with the action buttons column, with zero page scroll.

**What it involves:**
- Remove `overflow-y: auto` from `.filter-pane` and `max-height: 280px` from `.filter-pane-scroll-list`
- The pane must stretch to show all items — the surrounding flex row (`dashboard-flex`) already uses `align-items: stretch` so the pane grows with content
- Confirm that as the pane grows taller it doesn't push the page height beyond `100vh` — if it does, shrink the chart area (`dashboard-charts-box` flex) rather than letting the pane scroll or the page overflow
- Verify at a realistic category count (10–15 items) that nothing scrolls and the bottom edges still align

**What it touches:**  
`App/WebUI/src/styles/filterPaneStyles.css` · `App/WebUI/src/styles/dashboardStyles.css`

---

## ~~20 — Rename app title to "Personal Spending Pattern Visualisation Tool"~~ ✅

**Status:** `[x]` Done — 2026-09-20 &nbsp;·&nbsp; **Priority:** 🟡 P3 &nbsp;·&nbsp; **Effort:** 0.5 day &nbsp;·&nbsp; **Complexity:** Low

The login screen and browser tab currently show "Transaction Categorizer" / "Spending Pattern Visualisation Tool". Adding "Personal" before the title better describes the single-user, personal-finance nature of the product.

**What it involves:**
- Update the `<title>` tag in `App/WebUI/index.html`
- Update the display title on the login/signup screen (wherever the string "Transaction Categorizer" or "Spending Pattern Visualisation Tool" is rendered as text)
- Search for all other occurrences of the old title string in the codebase (JSX, config, meta tags) and update them
- Confirm the new title appears in the browser tab, the login screen, and any other surface that shows the app name

**What it touches:**  
`App/WebUI/index.html` · login/signup screen JSX · any other string references to the old title

---

## 21 — Auth service: OAuth providers + security controls

**Status:** `[ ]` &nbsp;·&nbsp; **Priority:** 🟠 P2 &nbsp;·&nbsp; **Effort:** 1–2 weeks &nbsp;·&nbsp; **Complexity:** High  
**Depends on:** Task 1 (auth isolation) — build this inside the standalone auth service once it exists

Once the shared Auth & Billing Service is isolated (task 1), extend it with proper OAuth sign-in options, automated account management flows, and database-driven security controls the owner can toggle without a code deploy.

### Sign-in providers
- **Email/password** — already exists; keep and polish
- **Google OAuth** — "Sign in with Google" via OAuth 2.0 / OIDC; link Google identity to existing account by email if one exists
- **Microsoft OAuth** — "Sign in with Microsoft" (Azure AD / personal accounts); same account-linking logic
- On first OAuth sign-in: create account automatically if email not already registered

### Automated account flows
- **Password reset** — "Forgot password" flow: send a time-limited reset link to the verified email; link expires after use or N minutes; bcrypt-hash the new password on submit
- **Email verification** — send a verification link on signup; gate certain features (or full access) on verified status
- **Welcome email** — triggered on first confirmed sign-in

### DB-controlled security flags
These live in the `users` table (or a `user_security` companion table) and can be flipped directly in the DB or via the owner admin page (task 17) without a code change:

| Flag / Column | Type | Purpose |
|---|---|---|
| `login_locked` | `boolean` | Manually lock an account — login rejected regardless of password |
| `failed_attempts` | `integer` | Counter incremented on each bad password; reset to 0 on success |
| `locked_until` | `timestamptz` | Auto-lock expiry — account unlocks automatically after this time passes |
| `max_attempts` | `integer` | Per-user override for the lockout threshold (null = use global default) |
| `require_password_reset` | `boolean` | Force the user to reset password on next login (e.g. after a suspected breach) |
| `oauth_only` | `boolean` | Disallow password login for this account — OAuth sign-in only |

**Lockout logic (server-side):**
1. On failed password: increment `failed_attempts`; if it hits the threshold, set `locked_until = now() + lockout_duration`
2. On login attempt: if `login_locked = true` OR `locked_until > now()`, reject with a clear message (don't leak whether the account exists)
3. On successful login: reset `failed_attempts = 0`, clear `locked_until`
4. Global defaults (threshold, lockout duration) in a `config` table or environment — individual overrides via `max_attempts`

### What it touches
Shared auth service: `routes/auth.py` · `schema.sql` (new columns) · email sending (SMTP or transactional email provider e.g. Resend / SendGrid) · OAuth app registrations in Google Cloud Console + Microsoft Azure · environment variables (`GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `SMTP_*`) · owner admin page (task 17) for flag management UI

---

## ~~22 — Responsive modal / popup audit~~ ✅

**Status:** `[x]` Done — 2026-09-20 &nbsp;·&nbsp; **Priority:** 🟡 P3 &nbsp;·&nbsp; **Effort:** 0.5 day &nbsp;·&nbsp; **Complexity:** Low

Full audit of every modal, popup, and overlay in the WebUI (all 17 CSS files + 44 JSX components) for clipping / overflow on smaller viewports (phone mimic + desktop short screens).

**What was fixed:**
- `.mr-card` (`manualReviewModal.css`): added `max-height: 90vh; overflow-y: auto` — was `overflow: hidden` with no height cap, clipping the category grid off-screen
- `.dashboard-chart-area` (`dashboardStyles.css`): added `padding-top: 12px` so chart title has breathing room from the top of the chart box
- `.modal-card` (`contentsStyles.css`): `overflow: hidden` → `overflow-y: auto`, `max-height: 70%` → `max-height: 70vh` — prevents card-level clipping
- `.modal-list` (`contentsStyles.css`): added `flex: 1; min-height: 0` to base rule (was only in `@media (max-width: 1023px)`) so the category list can actually scroll within the card's max-height on desktop

**Surfaces confirmed fine (no changes):** segment-popup-floating (already has `max-width: min(260px, 100vw-32px)`), upload-files-popup-box (has `max-height: 180px; overflow-y: auto`), manual-review-modal/stats modal (already `width: 90%`), all narrow cards (`max-width: calc(100vw - 32px)`).

---

## 22 — Admin panel security hardening

**Status:** `[ ]` &nbsp;·&nbsp; **Priority:** 🔴 P1 &nbsp;·&nbsp; **Effort:** 1–2 weeks &nbsp;·&nbsp; **Complexity:** High  
**Why before Stripe:** The admin panel is owner-facing infrastructure. It must be hardened before billing goes live — an unsecured admin panel with access to user accounts and subscription controls is a critical pre-launch risk.

**What it involves:**
- **IP whitelisting** — allowlist one or more IP ranges (or specific IPs) at the Flask level; requests not matching return 403 before any auth check. Config stored in env/DB so it can be updated without a redeploy. Admin panel only — not the main Cashflow API.
- **Stronger bot detection** — rate limit by IP on auth endpoints (login, signup, password reset); add `X-Request-Id` tracking; consider HMAC request signing for admin API calls from the frontend; honeypot field already exists on login forms but add server-side verification.
- **Malware / payload inspection** — validate all admin API inputs against unexpected patterns (oversized payloads, binary in text fields, path traversal in any string accepted as a name/identifier).
- **XSS hardening** — `Content-Security-Policy` header on all admin responses; `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; all admin API responses already return JSON but explicitly set `Content-Type: application/json`.
- **CSRF protection** — SameSite=Strict on admin session cookies; double-submit cookie pattern or CSRF token for all state-changing admin API calls.
- **Injection hardening** — audit all admin routes for raw string interpolation in SQL (should all be parameterised already, but verify); same for any shell calls.
- **Audit log** — all state-changing admin actions (role create/edit/delete, user reassign, category delete) already log to impersonation log; extend to cover all mutations with actor IP + timestamp.

**What it touches:**  
`tools/cashflow/API/routes/admin.py` · `tools/cashflow/API/backend.py` (headers, CORS, cookie config) · `tools/cashflow/API/rate_limits.py` · admin panel Nginx/Render config (if applicable)

---

## 23 — Role creation level-ceiling

**Status:** `[ ]` &nbsp;·&nbsp; **Priority:** 🟠 P2 &nbsp;·&nbsp; **Effort:** 0.5–1 day &nbsp;·&nbsp; **Complexity:** Low  
**Why:** The existing level-ceiling covers edit/delete/assign. Create is currently unrestricted — an admin-level user could create a role at or above owner level. This closes that gap to complete the hierarchy invariant.

**The rule (same as edit/delete):** `new_role.level >= caller.level → 403`. The actor must be strictly higher than the role they're creating.

**What it involves:**
- **Backend** (`admin_create_role`): add `if role_level >= caller_level: return 403` before INSERT. Caller level retrieved via `get_user_role_and_permissions` (same helper used for edit/delete).
- **Frontend** (`RolesScreen.jsx`): the "Create role" form's level input already has `maxLevel = caller.level - 1` applied to the edit modal — apply the same cap to the create form so the number field can't be set to `>= caller.level`. If the user is trying to save a level at or above, disable the Save button.
- No migration needed — purely logic.

**What it touches:**  
`tools/cashflow/API/routes/admin.py` (create_role endpoint) · `admin/src/screens/General/RolesScreen.jsx` (create modal validation)

---

## 24 — Role level auto-calculation from permissions

**Status:** `[ ]` &nbsp;·&nbsp; **Priority:** 🟠 P2 &nbsp;·&nbsp; **Effort:** 1–2 days &nbsp;·&nbsp; **Complexity:** Medium  
**Why:** Manual level entry is error-prone and disconnected from what the role actually does. Level should express the access a role grants, and access is defined by its permissions — so level should derive from permissions, not be entered independently.

**What it involves:**
- Define a permission-to-weight mapping (e.g. `admin.panel.view = 50`, `admin.users.manage = 80`, `admin.roles.manage = 90`, `admin.billing.manage = 95`) — stored in a config table or constants file so it can be tuned without a code change.
- `level = max(weight of assigned permissions)` — the highest-weight permission determines the floor. Level can optionally be overridden upward (for future-proofing) but never below the floor.
- Remove the manual level number input from the create/edit role form in the admin panel UI.
- Backend: recalculate level on every role create/update before INSERT/UPDATE.
- Existing roles: one-time migration script recalculates their levels from current permission sets (or owner manually re-saves each role to trigger recalc).
- Owner role is always `level = 100` (or max integer) regardless of permissions — hard-coded floor.

**What it touches:**  
`tools/cashflow/API/routes/admin.py` (create/edit role) · `admin/src/screens/General/RolesScreen.jsx` (remove level input, show calculated preview) · new `permissions_weights` config table or constants file

---

## 25 — IndexedDB client storage layer

**Status:** `[ ]` &nbsp;·&nbsp; **Priority:** 🟠 P2 &nbsp;·&nbsp; **Effort:** 1–2 weeks &nbsp;·&nbsp; **Complexity:** High  
**Why before Stripe:** Stripe checkout and subscription state benefit from robust client-side persistence. IndexedDB also gives native encryption — sensitive preference data and cached transaction records shouldn't sit in plaintext localStorage.

**What it involves:**

### Core store
Replace `localStorage` and `sessionStorage` across the web app with a structured IndexedDB layer:
- Object stores: `preferences`, `session`, `transactions_cache`, `categories_cache`
- Wrapper library: thin custom hook / util (`useIDB`) — `get(store, key)`, `set(store, key, value)`, `delete(store, key)`, `clear(store)` — returns Promises; no raw IDB boilerplate in components.
- **Transactions + rollback:** multi-key writes use IDB's native transaction; on error, transaction aborts and rolls back atomically. No partial writes.

### Encryption
- Use the **Web Crypto API** (`SubtleCrypto`) — natively available in all modern browsers, no library needed.
- Derive a per-user key via `PBKDF2` from a combination of the user's JWT sub + a device secret (stored separately in a secure origin-scoped value). Key is derived at session start and held in memory only — never persisted.
- Encrypt sensitive stores (`preferences`, `session`) at-rest using `AES-GCM`. Non-sensitive caches (`transactions_cache`, `categories_cache`) can be unencrypted for read performance.
- On key derivation failure (corrupt device secret, cleared origin storage): gracefully fall back to re-fetching from server — no crash.

### Auto-sync
- All writes to `preferences` and `session` stores automatically enqueue a debounced server sync (existing 2s debounce pattern already used in `UserPreferencesContext`).
- On network failure: writes queue locally; flush on next successful network contact.
- On app open: IDB read is the fast path; server fetch runs in background and updates IDB if newer data arrives.

### Fallback for aggressive client-side clearing
Safari Private Browsing and some iOS/Android browser configurations may deny IDB writes or clear IDB aggressively. The existing localStorage-based framework must remain as a degraded-mode fallback:
- Detect IDB availability at startup (`try { open IDB } catch { use localStorage fallback }`).
- Fallback must be transparent — no UI change, just reduced persistence.
- Encryption is skipped in fallback mode (localStorage can't be encrypted at-rest meaningfully).

### What it touches
`tools/cashflow/WebUI/src/appState/UserPreferencesContext.jsx` · `tools/cashflow/WebUI/src/appState/AuthContext.jsx` · all `localStorage.*` / `sessionStorage.*` call sites in `WebUI/src/` · new `tools/cashflow/WebUI/src/utils/idb.js` (wrapper) · new `tools/cashflow/WebUI/src/utils/crypto.js` (encryption helpers)

---

## Dependency Order

```
22 (Admin security hardening) ──► 3 (Stripe)    [security must be solid before billing goes live]
23 (Role creation ceiling) ──► 24 (Level auto-calc)  [small, do together in one session]
25 (IndexedDB) ──► 3 (Stripe)                    [client persistence needed before Stripe UX]

1 (Auth isolation) ──► 5 (JWT gating) ──► 6 (Subdomain linkage)
                   ──► 3 (Stripe)     ──► 4 (Webhooks) ──► 7 (Trials)
                                                         ──► 8 (Portal)
                   ──► 21 (OAuth + security controls)
2 (Landing page) depends on 1 + 6

10 (RN update) ──► 15 (Hard testing)
12 (Info popup) ─┐
13 (Security popup) ─┤──► 11 (No scroll) ──► 15 (Hard testing)
9  (Category bug) ──┘

15 (Hard testing) ──► 16 (Automated tests)
```

---

## Notes

- The shared Auth & Billing Service (tasks 1–8) is a new standalone product, separate from the Cashflow codebase. It will likely live in its own repo.
- Existing Cashflow users need a migration plan when auth is isolated — decide: grandfather them in free, require subscription, or offer a grace period.
- Trial policy (card required vs. not, trial length) is a business decision that must be made before task 7 is built.
- Tasks 12 and 13 (popups) directly reduce task 11's scope — do them first.
- Task 16 (automated testing) needs a scoping conversation before any implementation begins.
- Task 18 (repo migration) should happen after the public-facing URL from Pages is no longer load-bearing — i.e. after the landing page (task 2) and shared auth service (task 1) are live and users are redirected through the real product URL instead of GitHub Pages.

---

## 📅 Daily Progress Log

| Date | Status | Overall % | Note |
|------|--------|-----------|------|
| 20 Sep 2026 | 🟢 Progressing well | ~18% | UI polish sprint — tasks 19 & 20 done, header/filter/mobile fixes shipped. Tasks 14 and 1 (auth, no billing) targeted for today. |
| 20 Sep 2026 | 🟢 Progressing well | ~19% | Responsive modal/popup audit — task 22 added and completed: mr-card scrollable, dashboard chart spacing, modal-card/modal-list desktop scroll fix. All shipped to main. |
| 21 Sep 2026 | 🟢 Planning | ~19% | Full auth + platform architecture discussion. No code today — agreed design for email auth, SMTP email sending, email verification, password reset, Google + Microsoft OAuth, Stripe billing, profile UI, isolation audit, and monorepo platform structure. Design doc written: `context/auth-design.md`. Implementation begins next session. |
| 23 Sep 2026 | 🟢 Progressing well | ~45% | Auth system fully shipped: email verification, forgot/reset password, failed-attempt lockout, account deletion with 48h grace + cancellation. Brevo HTTP API for transactional email (SMTP blocked on Render). Platform restructure: landing page live, Cashflow moved to `tools/cashflow/`, dual deploy workflows. Admin panel built and deployed (standalone Vite + React, HashRouter, GitHub Pages at `/utility-tools/admin/`): roles management, users management, category management, impersonation/deletion logs. Task 2 ✓, Task 17 ✓, Task 21 partially ✓ (OAuth still pending). |
| 24 Sep 2026 | 🟢 Progressing well | ~50% | Admin panel hardening: level-ceiling enforcement on all manipulation endpoints — no exceptions, no owner bypass (actor must be STRICTLY higher than target before and after). Email CC matrix: scheduled/cancelled/permanent deletion emails To: actor CC: owner. `pending_deletion_by_email` stored at schedule time so cron can email actor 48h later. Cancel emails added for roles and categories. Removed redundant `PROTECTED_ROLE_NAMES` check. Fixed `_get_owner_email` wrong join (`user_roles` doesn't exist — schema uses `users.role_id`). Migration `add_pending_deletion_by_email.sql` run on Supabase. Priority reorder confirmed: Stripe billing (Tasks 3+4) next, then React Native (Task 10), then OAuth (lowest). |
| 26 Sep 2026 | 🟢 Planning | ~50% | Task backlog expanded: added Tasks 22 (admin security hardening), 23 (role creation ceiling), 24 (role level auto-calc from permissions), 25 (IndexedDB client storage with encryption + fallback). Priority reorder: 22 → 3+4 (Stripe) → 23+24 → 25 → 5+6 → 10 (RN) → 21 (OAuth). Wakeup spinner also wired to login form submit on both landing and admin. |
