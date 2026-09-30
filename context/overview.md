<!-- last-verified: eb0073b 2026-09-23 -->
# Cashflow2.0 — Project Overview

## Purpose

Personal-finance transaction tracker for a small, known user set (not a public SaaS). Users upload bank statement exports (CSV or Excel), the backend auto-categorizes every transaction, and both a web app and a mobile app visualize spending by category over time alongside a searchable transaction table.

The core value proposition is the categorization pipeline: transactions are classified progressively (cheap → expensive) so manual review burden decreases as the user's own transaction history grows.

## Main Functionality

1. Upload CSV/Excel bank statements → deduplicate → auto-categorize
2. View monthly/yearly stacked-bar spending charts, filterable by category
3. Browse, search, filter, and bulk-recategorize a full transaction table
4. Manual review flow for transactions the pipeline couldn't classify
5. Admin tooling for user/role/permission/category management

## Major Subsystems

| Subsystem | Location | Purpose |
|---|---|---|
| Flask API | `App/API/` | Backend: auth, upload, categorization, charts, admin routes |
| Categorization Pipeline | `App/API/categorise/` | Tiered: exact → merchant → fuzzy → LLM → manual |
| Web Frontend | `App/WebUI/` | Vite/React web app |
| Mobile Frontend | `App/NativeAppUI/` | Expo/React Native app |
| Shared Utils | `App/shared/` | Cross-platform JS constants/helpers |
| Admin CLI | `App/adminClI/` | Standalone Python scripts for production DB management |
| GitHub Actions | `.github/workflows/` | Deploy, nightly backup, keep-alive |

## Technology Stack

- **Backend**: Python 3.13, Flask 3.1, Flask-JWT-Extended, psycopg2 (raw SQL, no ORM), Supabase-hosted Postgres, Gemini (LLM tier), rapidfuzz + pyahocorasick (fuzzy/merchant matching), gunicorn
- **Web**: React 19, Vite, react-router-dom v7, recharts, @tanstack/react-virtual, plain CSS
- **Mobile**: Expo SDK 54 / React Native 0.81, react-navigation, react-native-gifted-charts, expo-secure-store
- **Shared**: Small JS utils module wired into RN via metro.config.js resolver alias
- **CI/CD**: GitHub Actions (deploy + nightly pg_dump backup + keep-alive ping)

## External Services

- **Supabase** — hosted Postgres database
- **Render** — backend deployment (`https://utility-tools-b6dj.onrender.com`, Frankfurt; URL lives in `backend-url.json`)
- **Google Gemini** — LLM categorization tier
- **GitHub Actions** — automated deploy, backup, keep-alive

## Important Terminology

- **NEEDS_MANUAL_REVIEW** — sentinel string (not a real category) placed on transactions the pipeline couldn't classify. Defined in `App/shared/checkingName.js`, duplicated in `App/NativeAppUI/checkingName.js` and `App/WebUI/src/checkingName.jsx`.
- **dedup_key** — hash per transaction row used to detect re-uploaded duplicates
- **category_records** — DB table driving the exact-match tier (user's own prior categorization history)
- **FilterPane** — combined category-checkbox + drag-to-reorder component shared by Dashboard and ChartsScreen on both platforms

## High-Level Architecture

```
User
  ↓
Web App (React/Vite)  or  Mobile App (Expo/RN)
  ↓
Flask API (Render)
  ↓
Postgres (Supabase)
      +
Gemini API (LLM tier only)
```

Auth: web uses httpOnly JWT cookie; RN uses expo-secure-store.
