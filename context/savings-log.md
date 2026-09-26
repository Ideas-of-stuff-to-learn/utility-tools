<!-- last-verified: 7e49833 2026-09-24 -->
2026-09-26 | task: add soft-launch + hard-launch checklists to backlog | SQLite queries: 0 | context docs loaded: 2 (backlog, revert-state) | full repo scan avoided: yes | docs-only update; no source code touched
2026-09-24 | task: backlog update — check-in 1, task 17 done, daily log 23-24 Sep | SQLite queries: 0 | context docs loaded: 3 (revert-state, savings-log, backlog) | full repo scan avoided: yes | compacted session resume; docs-only update
2026-09-24 | task: level-ceiling enforcement + email CC matrix + cancel emails | SQLite queries: 0 | context docs loaded: 4 (compacted session summary, admin.py, categories.py, permissions.py) | full repo scan avoided: yes | 9 source files changed, 3 commits shipped, bug fix on _get_owner_email wrong join
2026-09-23 | task: catch-up after claude-intelligence-plugin install | SQLite queries: 1 | context docs loaded: 2 (handoff, current-task) | full repo scan avoided: yes | added AI harness section to architecture.md; stamped staleness markers on all 15 docs
2026-09-23 | task: Tasks 3-5 — email verification, password reset, profile UI, soft-delete, GitHub Actions | SQLite queries: 0 | context docs loaded: 2 (session-snapshot, current-task) | full repo scan avoided: yes | continued from compacted session
2026-09-23 | task: Auth isolation — move auth to landing page, Cashflow platform tool | SQLite queries: 0 | context docs loaded: 0 (used session summary) | full repo scan avoided: yes | 31 files changed, both builds pass, commit a834bca
# Intelligence System — Savings Log

Each entry = one session that used the intelligence system instead of cold-scanning the repo.

2026-09-17 | task: dashboard layout, info popup, data security page, viewport lock, chart height, bottom alignment | SQLite queries: 2 | context docs loaded: 4 | full repo scan avoided: yes | resumed from compacted context via handoff.md
2026-09-20 | task: responsive modal/popup audit + dashboard chart spacing | SQLite queries: 0 | context docs loaded: 2 (current-task, handoff via summary) | full repo scan avoided: yes | targeted glob+read of 17 CSS files + 44 JSX components only
2026-09-21 | task: auth & platform architecture design | SQLite queries: 2 | context docs loaded: 3 (handoff, current-task, auth.py read) | full repo scan avoided: yes | discussion-only session; no code changed; auth-design.md created
2026-09-20 | task: app title centralisation, header flex layout, filter pane spacing, mobile pills routing, popup mobile scroll | SQLite queries: 0 | context docs loaded: 4 | full repo scan avoided: yes | resumed from compacted context via handoff.md

2026-09-23 | task: Block 2b — 5 hook scripts, session-snapshot, 3 ship skills, enforcement rules in AGENTS.md, DB/sync registration | SQLite queries: 0 | context docs loaded: 3 (via session summary) | full repo scan avoided: yes | continued from compacted context; all Block 2b items completed and committed 87f997d

Format:
```
YYYY-MM-DD | task: <what was done> | SQLite queries: <N> | context docs loaded: <N> | full repo scan avoided: yes/no | notes
```

---

| Date | Task | SQLite queries | Context docs loaded | Repo scan avoided | Notes |
|---|---|---|---|---|---|
| 2026-09-15 | Build full intelligence system | 0 (first build) | all | n/a | Initial implementation session |
| 2026-09-16 | UserPreferences context, column resize persist, delete removal, info popup | 0 | handoff + current-task | yes | Context recovered from conversation summary |
| 2026-09-16 | Preferences sync lifecycle fixes, virtualizer height fix, CSS breakpoint sync | 0 | handoff + current-task | yes | Continued same session |
| 2026-09-15 | Manual review UX + auth fixes | 3 | architecture, constraints, handoff | yes | SQLite queried for manual review files; no full repo scan needed |
| 2026-09-16 | Legal pages: /privacy, /terms, /accessibility, /cookies | 0 | App.jsx, routes.jsx, Layout.jsx only | yes | Continued from compacted session; all context from summary |
2026-09-17 | task: FilterPane order/persist bug fixes | SQLite queries: 3 | context docs loaded: 4 | full repo scan avoided: yes | useStackOrder hydration fix + FilterPane button visibility fix
2026-09-17 | task: FilterPane persist-to-DB fix (flushNow) | SQLite queries: 0 | context docs loaded: 0 | full repo scan avoided: yes | added flushNow to UserPreferencesContext; togglePersist+resetOrder now write to server immediately
2026-09-17 | task: Manual review UX fixes (decimal pct, optimistic exit, spinner fallback, resolve-and-exit endpoint) | SQLite queries: 0 | context docs loaded: 2 | full repo scan avoided: yes | also marked task 9 complete in backlog
2026-09-23 | task: add step 0b to auth-design (rename breakage fixes) | SQLite queries: 0 | context docs loaded: 1 (auth-design) | full repo scan avoided: yes | notes: subagent already had findings from prior discuss
2026-09-23 | task: Task 0b - propagate GitHub rename Cashflow2.0->utility-tools | SQLite queries: 0 | context docs loaded: 1 (gitContext) | full repo scan avoided: yes | 7 files updated, build verified green
2026-09-23 | task: Task 1 - email migration (auth.py + api.jsx + LoginScreen + SignupScreen) | SQLite queries: 0 | context docs loaded: 1 (auth-design) | full repo scan avoided: yes | build verified green
2026-09-23 | task: Task 2 - email_service.py (Gmail SMTP module) | SQLite queries: 0 | context docs loaded: 0 | full repo scan avoided: yes | new file only, no existing code modified
