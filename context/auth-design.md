<!-- last-verified: eb0073b 2026-09-23 -->
# Auth & Platform Architecture — Design Document

**Session:** 2026-09-21  
**Status:** Discussion complete — agreed design, not yet implemented

---

## 1. Platform Vision

Cashflow2.0 is being evolved into a **multi-tool platform**. The repo will be renamed to the platform name. Auth lives at the platform level, not inside any individual tool.

```
Landing Page  (platform root)
    ↓
One Auth System  (login / signup / OAuth / billing)
    ↓
Workspace / tool selector
    ├── Cashflow  (current App/ → tools/cashflow/)
    ├── Tool 2   (future)
    └── ...
```

**Repo structure (target):**
```
/
├── landing/          ← landing page + auth UI
├── tools/
│   ├── cashflow/     ← current App/ moves here
│   └── ...
└── shared/           ← auth logic, shared types, common utils
```

**One monorepo** — not separate repos per tool. Rationale: one person, one CI/CD pipeline, shared auth code not duplicated, scales without coordination overhead until there are separate teams.

---

## 2. Identity Model

### Login credential
- **Email address** — primary identifier, used to log in
- **Display name** — optional, user-settable, used in UI ("Welcome, Armaan"), not for auth
- Current `username` column → migrate as `display_name` for existing users

### Users table additions
```sql
ALTER TABLE users ADD COLUMN email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN oauth_provider TEXT;   -- 'google', 'microsoft', null
ALTER TABLE users ADD COLUMN oauth_sub TEXT;         -- provider's user ID
-- password_hash becomes nullable (OAuth-only users have no password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'none';
                                               -- 'none','trialing','active','past_due','canceled'
```

### Existing users
- Soft migration: `email` column nullable — existing accounts unaffected
- On first profile visit, user is prompted to add an email (verified via confirmation link)
- No forced migration / no blocking redirect at login — gradual

---

## 3. Profile UI

### Click target in header (top-right, always present)
- User has a role badge (admin/owner) → badge is clickable
- Regular `user` role (no badge) → generic avatar icon (circle head + shoulder arc SVG), same size/position as a badge
- Constraint preserved: owner badge stays top-right per existing hard constraint

### Profile popup (on click)
Small card anchored to the click target:
- Display name, email, role
- "Edit Profile" → navigates to `/profile`
- "Logout" quick action

### Profile page (`/profile`)
Full page, themed, back button top-left. Sections:
- **Display name** — editable, saves immediately
- **Email** — shows current verified email; "Add email" if none; "Change email" opens re-verification flow
- **Password** — change password (requires current password; OAuth-only users shown info message)
- **Danger zone** — Delete account (bottom of page)

---

## 4. Email Sending

### Method
Python `smtplib` (stdlib — no third-party SDK) via **Gmail SMTP**:
- `smtp.gmail.com:465` (SSL)
- One Gmail account owned by the platform (e.g. `noreply@...`)
- Gmail App Password stored in `.env` as `SMTP_PASSWORD` (requires 2FA enabled on the Gmail account, then generate App Password under Google Account → Security → App Passwords)
- Users never see or interact with this account; it is purely a dispatch pipe

### `.env` additions
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=yourapp@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx
```

### Rate limiting
- Route-level: new `RL_AUTH_EMAIL_*` constants in `rate_limits.py` (per-endpoint, toggleable)
- Per-user cooldown: `last_email_sent_at` column on `users` — enforced in route logic (e.g. 60s minimum between requests)
- Gmail hard cap: ~500 emails/day (backstop, not primary guard)

### Flows that send email
1. **Email verification** — on add/change email: signed time-limited token in link → `POST /auth/verify-email?token=...`
2. **Password reset** — "Forgot password": signed token → `POST /auth/reset-password` with token + new password
3. **Welcome email** — on first confirmed sign-in (optional, low priority)

### Token approach
Short-lived JWT (15 min expiry) containing `user_id` + `new_email` + `action` — no extra DB table needed. On use: decode, verify not expired, verify `action` matches endpoint, save email, mark verified, invalidate by checking `iat` against a `last_token_used_at` timestamp.

---

## 5. OAuth — Google & Microsoft

### Scope
- **Google:** personal (`@gmail.com`) + Google Workspace (`@company.com`) — both via same flow
- **Microsoft:** personal (`@outlook.com`, `@hotmail.com`) + Microsoft 365 / Entra work accounts — use `/common` tenant endpoint to accept both
- **Cost:** free for both providers

### Flow (identical for both providers)
1. User clicks "Sign in with Google/Microsoft" → redirect to `/auth/google` or `/auth/microsoft`
2. Backend redirects to provider consent page
3. Provider redirects back to `/auth/google/callback` (or `/microsoft/callback`) with a `code`
4. Backend exchanges `code` for `id_token` via provider's token endpoint
5. Decode `id_token` → extract `email`, `name`, provider `sub` (user ID)
6. DB lookup on email:
   - Match found → log in, issue JWT
   - No match → create user row (`oauth_provider`, `oauth_sub`, `email`, `email_verified=true`), log in
7. Issue JWT as normal — session from here is identical to email/password login

### Setup (one-time, per provider)
**Google:**
- Google Cloud Console → create project → enable OAuth → OAuth credentials → `CLIENT_ID` + `CLIENT_SECRET`
- Redirect URI: `https://yourapp.com/auth/google/callback`
- Cost: free

**Microsoft:**
- Azure Portal → App registrations → register app → `CLIENT_ID` + `CLIENT_SECRET` + tenant = `common`
- Redirect URI: `https://yourapp.com/auth/microsoft/callback`
- Cost: free

### Library
`authlib` (Python) — handles code exchange, token decoding, provider configs for both providers

### `.env` additions
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```

### React Native
RN OAuth is parked — different mechanism (device native browser / provider SDK). Will need updating when RN is brought up to date (task 10). Note when implementing: RN uses a different redirect URI scheme (`cashflow://auth/callback`) and needs `expo-auth-session` or similar.

---

## 6. Stripe Billing

### Model
- **Per-tool gating** — each tool has its own subscription; a user can be on free for Cashflow but paying for Tool 2
- **Free trial** — configurable by platform owner: trial length, card-required or not, per-user or global
- **Admin-configurable** — gates and trial terms adjustable without a code deploy (DB config or owner admin page)
- **No paywall on the whole platform** — individual tools are gated, not the auth layer itself

### Stripe setup
- One Stripe account for the platform
- One Stripe Product + Price per tool (e.g. "Cashflow — Monthly")
- `stripe_customer_id` stored on `users` row (created at signup)
- `subscription_status` column: `none` | `trialing` | `active` | `past_due` | `canceled`

### Subscriptions table
```sql
CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id TEXT NOT NULL,                          -- 'cashflow', 'tool2', etc.
    stripe_subscription_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'none',
    current_period_end TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Webhook endpoint (`POST /stripe/webhook`)
Handles events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Verify Stripe signature before processing (`stripe.Webhook.construct_event`)
- Update `subscriptions` table on each event
- `trialing` treated same as `active` for access checks

### Feature gating
- JWT payload includes `tools` claim: list of tool IDs with `active`/`trialing` subscription
- Each tool's backend verifies its own ID is in `tools` claim
- Free tier / trial: controlled via `subscription_status`; specific feature limits configurable in DB

### Cost
Stripe takes ~2.9% + 30¢ per transaction. No monthly platform fee.

---

## 7. Security Controls (DB-driven)

Columns on `users` (or `user_security` companion table), flippable via DB or owner admin page (task 17) without a code change:

| Column | Type | Purpose |
|---|---|---|
| `login_locked` | `boolean` | Manually lock account — login rejected regardless of password |
| `failed_attempts` | `integer` | Counter incremented on bad password; reset on success |
| `locked_until` | `timestamptz` | Auto-lock expiry — account unlocks automatically |
| `max_attempts` | `integer` | Per-user override for lockout threshold (null = global default) |
| `require_password_reset` | `boolean` | Force password reset on next login |
| `oauth_only` | `boolean` | Disallow password login — OAuth sign-in only |

**Lockout logic:**
1. Failed password → increment `failed_attempts`; if threshold hit → set `locked_until = now() + duration`
2. Login attempt → if `login_locked = true` OR `locked_until > now()` → reject (don't leak account existence)
3. Successful login → reset `failed_attempts = 0`, clear `locked_until`
4. Global defaults (threshold, duration) in `config` table or env; individual overrides via `max_attempts`

---

## 8. Isolation Audit (Required Before Launch)

Before any paying users, every DB query touching `transactions`, `categorized_records`, `uploads`, `preferences` must be confirmed to filter by the JWT identity's `user_id`. A dedicated audit pass is needed:
- Review all route files in `App/API/routes/`
- Confirm `scope='global'` categorized_records are intentionally shared (not a leak)
- Confirm admin routes are gated behind roles/permissions system

---

## 9. Agreed Implementation Order

```
0. Repo rename propagation                                ✅ DONE 2026-09-23 — renamed to
                                                            utility-tools on GitHub; git remote
                                                            updated locally
0b. Fix rename breakages                                  ✅ DONE 2026-09-23 — all 7 files
                                                            updated (vite.config.js, App.jsx,
                                                            404.html, gitContext.md,
                                                            rebuild_db.py, chatLog.txt,
                                                            10_web-migration.txt); build verified
1. Email migration (schema + auth routes + login UI)       ✅ DONE 2026-09-23
2. Gmail SMTP setup + email sending module                 ✅ DONE 2026-09-23
3. Email verification flow                                 ✅ DONE 2026-09-23
4. Password reset flow                                     ✅ DONE 2026-09-23
5. Profile UI (popup + /profile page)                     ← now has full data to display
6. Isolation audit                                        ← safety before more users
7. Google OAuth                                           ← highest demand social login
8. Microsoft OAuth                                        ← same code path, low marginal effort
9. Stripe billing + webhooks + feature gating             ← last, depends on all above
10. Free trial config                                     ← part of Stripe setup
```

---

## 10. Open Questions / Decisions Not Yet Made

- Platform / company name (for repo rename, domain, Stripe account)
- Gmail address to use for sending (`noreply@...`)
- Stripe tier model specifics: what does free tier allow vs paid per tool? Upload limits? Feature limits?
- Trial length and whether card is required for trial
- Whether existing Cashflow users are grandfathered in free or required to subscribe

---

## 11. Additional Platform Tasks (scoped 2026-09-26)

These are scoped and queued — not yet in the implementation order above. They sit between the current completed work and the Stripe build.

---

### 11a. Admin Credential Isolation — Separate Admin User Accounts (Task 27)

**Do first — this is the foundation for Tasks 26 and 22.**

Admin panel users are a completely separate user base. A Cashflow username/password cannot be used to log into the admin panel. They live in different tables, checked against different credentials.

**`admin_users` table** (new):
```sql
CREATE TABLE admin_users (
    id              SERIAL PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role_id         INTEGER REFERENCES roles(id),
    created_by      INTEGER REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ,
    login_locked    BOOLEAN NOT NULL DEFAULT false,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ
);
```

**Bootstrap:** `flask create-admin` CLI command creates the first owner-level admin account. Runs once on deploy; credentials entered at that point, not hardcoded.

**`POST /admin/auth/login`** queries `admin_users`, never `users`.

**Admin signup removed.** New admin accounts created by owner inside the admin panel (Users screen → "Add admin user"). `admin/src/screens/Auth/SignupScreen.jsx` removed or replaced with info screen. No self-signup path.

**Role system reused** — `admin_users.role_id` references existing `roles` table; permission checks work as before, just against `admin_users` identity.

---

### 11c. Admin Session Isolation — Explicit Re-Login Required (Task 26) — depends on 27

**This is a prerequisite for Task 22 and all admin security hardening.** It is the most fundamental admin security property.

**Current broken state:** Admin panel calls `GET /auth/me` with `credentials: 'include'`, sending the same httpOnly cookie the landing page sets. Landing page login → navigate to admin → auto-logged in. A compromised user session = compromised admin panel.

**Required behaviour:** Landing page login never grants admin panel access. Admin panel always requires its own explicit login. Sessions are separate, separately revokable, separately expiring.

**Backend changes:**
- `POST /admin/auth/login` — validates credentials, issues `admin_access_token` + `admin_refresh_token` cookies (different names from `access_token`/`refresh_token`).
  - Cookie config: `HttpOnly=True`, `SameSite=Strict`, `Secure=True` in production.
  - Access token expiry: 2h (shorter than regular session — high-privilege panel).
  - Refresh token expiry: 24h (shorter than regular 30-day refresh).
- `POST /admin/auth/refresh` — refreshes using `admin_refresh_token` only.
- `POST /admin/auth/logout` — clears admin cookies only; does not touch regular session.
- `GET /admin/auth/me` — returns identity but validates `admin_access_token` only; 401 if absent regardless of regular session.
- Regular `POST /auth/login` explicitly must never set admin cookies.

**Admin `api.js` changes:**
- `login()` → `POST /admin/auth/login`; stores `csrf_admin_access_token` in memory.
- `getMe()` → `GET /admin/auth/me`.
- `logout()` → `POST /admin/auth/logout`.
- All `authFetch` sends `X-CSRF-TOKEN: csrf_admin_access_token`.

**No UI change** — same login form, same credentials, just always requires entry.

---

### 11d. Admin Panel Security Hardening (Task 22) — depends on 26 + 27

The admin panel is owner-facing infrastructure and must be hardened before billing goes live.

**IP whitelisting**
- Flask middleware checks `request.remote_addr` (with `ProxyFix` already applied) against an allowlist stored in env/DB.
- Non-matching requests → 403 before any auth check.
- Admin panel only — does not apply to the main Cashflow API.
- Config: `ADMIN_IP_ALLOWLIST` env var (comma-separated CIDR ranges or IPs); empty = no restriction (dev mode).

**Bot detection**
- Rate limit by IP on all admin auth endpoints (existing `rate_limits.py` framework extended with `RL_ADMIN_AUTH_*` constants).
- Honeypot fields already exist on login forms; add server-side enforcement — reject any request where the honeypot field is non-empty.
- `X-Request-Id` header tracked in admin audit log for correlation.
- Consider HMAC request signing: admin frontend generates a per-request signature (timestamp + body hash signed with a session-derived secret) — backend verifies. Prevents replayed or crafted API calls.

**Payload / malware inspection**
- Max payload size enforcement (`MAX_CONTENT_LENGTH` on Flask).
- Input validation on all admin API string fields: role names, category names, user identifiers — reject null bytes, path-traversal patterns (`../`), oversized values.
- Binary content rejected in text fields.

**XSS / header hardening**
- `Content-Security-Policy: default-src 'self'` on all admin API responses.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` added to all admin responses.
- All admin responses already JSON; explicitly enforce `Content-Type: application/json`.

**CSRF protection**
- `SameSite=Strict` on the admin session JWT cookie.
- Double-submit cookie pattern or per-session CSRF token for all state-changing admin API calls.

**SQL injection audit**
- All admin routes already use parameterised queries (psycopg2 `%s` style) — verify no raw string interpolation exists in admin.py, categories.py, or any helper.

---

### 11b. Role Creation Level-Ceiling (Task 23)

The existing level-ceiling enforces `target_level >= caller_level → 403` on edit, delete, and assign. CREATE is currently unrestricted.

**Rule:** `new_role.level >= caller.level → 403`. Actor must be strictly higher than the role they are creating.

**Backend change** (`admin_create_role`):
```python
caller_role, caller_level, _perms = get_user_role_and_permissions(conn, current_user)
if requested_level >= caller_level:
    return jsonify({'error': f'Cannot create a role at or above your own level ({caller_level})'}), 403
```

**Frontend change** (`RolesScreen.jsx`):
- Create modal: level field capped at `caller.level - 1` (same `maxLevel` already applied to edit modal).
- Save button disabled if level input reaches or exceeds `caller.level`.

---

### 11c. Role Level Auto-Calculation from Permissions (Task 24)

Manual level entry is disconnected from what a role actually grants. Level should be derived from the highest-weight permission assigned.

**Permission weight map** (stored in a `permission_weights` config table or constants in `permissions.py`):

| Permission | Weight |
|---|---|
| `admin.panel.view` | 50 |
| `admin.users.view` | 60 |
| `admin.users.manage` | 70 |
| `admin.roles.view` | 75 |
| `admin.roles.manage` | 85 |
| `admin.billing.manage` | 90 |
| `admin.impersonation` | 95 |
| *(owner — hardcoded)* | 100 |

**Calculation:** `level = max(weight for each assigned permission)`. If no permissions, level = 1.

**Override rule:** level may be set higher than the calculated floor (for future-proofing) but never below it. Owner is always 100 regardless.

**Backend:** recalculate on every role create/update before INSERT/UPDATE.

**Frontend:** remove the manual level number input from create and edit forms. Show a read-only "Calculated level: X" preview that updates live as permissions are checked/unchecked.

**Migration:** one-time script to recalculate existing roles from their current permission sets.

---

### 11d. IndexedDB Client Storage Layer (Task 25)

Replace `localStorage`/`sessionStorage` with a structured, encrypted IndexedDB layer.

**Object stores**
| Store | Encrypted | Purpose |
|---|---|---|
| `session` | ✅ | JWT token, auth state |
| `preferences` | ✅ | Column widths, stack order, theme |
| `transactions_cache` | ❌ | Cached transaction rows (read perf) |
| `categories_cache` | ❌ | Cached category list |

**API wrapper** (`src/utils/idb.js`)
```js
idb.get(store, key)         // → Promise<value | null>
idb.set(store, key, value)  // → Promise<void>  (uses IDB transaction internally)
idb.delete(store, key)      // → Promise<void>
idb.clear(store)            // → Promise<void>
idb.transaction(fn)         // → Promise  — fn receives a tx, runs atomically, auto-rollback on throw
```

**Encryption** (`src/utils/crypto.js`)
- Web Crypto API (`SubtleCrypto`) — no external library.
- Key derivation: `PBKDF2(password = JWT sub + device_id, salt = origin-scoped random, iterations = 100k, hash = SHA-256)` → `AES-GCM` key.
- `device_id` is a random UUID generated once and stored in a separate, non-encrypted IDB store (or a dedicated cookie with `HttpOnly=false` since it's not a secret, just a device fingerprint).
- Key held in memory only (never stored). Derived at session start, cleared on logout.
- On decryption failure → treat as cache miss → re-fetch from server.

**Auto-sync**
- Writes to `preferences` and `session` enqueue a debounced server sync (existing 2s debounce pattern in `UserPreferencesContext` extended to use IDB writes instead of `localStorage` writes).
- Network failure → writes queue locally; flush on reconnect.
- App open → IDB read first (fast path), server fetch runs in background and updates IDB if server data is newer (compare `updated_at` timestamps).

**Fallback (Safari Private / aggressive clearing)**
```js
async function openIDB() {
    try {
        // attempt IDB open
    } catch {
        return null; // signal fallback mode
    }
}
// All idb.* calls check for null and fall back to localStorage silently
```
- Encryption skipped in fallback mode.
- No UI change — degraded persistence only.
- Existing localStorage framework remains intact as the fallback layer; no removal until IDB is proven stable across all target browsers/devices.
- Domain name (needed for OAuth redirect URIs and subdomain linkage)
