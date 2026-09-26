<!-- last-verified: f366d81 2026-09-24 -->
2026-09-26 | task: add soft-launch + hard-launch checklists to backlog | safe-point: b9fb3981cfb2a06b479d6747938074f134b165e9 | status: complete
2026-09-24 | task: admin page startup spinner + progress bar | safe-point: f366d81008c03f0c85fdb97b1034a816a7c928c1 | status: complete
2026-09-24 | task: wakeup spinner on login form submit (landing + admin) | safe-point: 75ce9be6d402fb8353b9a6d98c67d6150163bbfe | status: in-progress
2026-09-24 | task: backlog update — check-in 1, task 17 done, daily log 23-24 Sep | safe-point: 7e498332e09247f8310211c3a0e5d70ece576022 | status: complete
2026-09-24 | task: level-ceiling enforcement + email CC matrix + cancel emails | safe-point: e6ffe8b30d28f2553fd30df9a6e8bb485197a9dd | status: complete
2026-09-24 | task: switch SMTP to port 587 STARTTLS (port 465 blocked on Render) | safe-point: 86be8755d0cba0ff7a80405f9c8823c2eb1cefeb | status: in-progress
2026-09-24 | task: ProxyFix + remove default_limits to fix shared-IP rate limit bucket | safe-point: b09b9ce5f7a48198e6ba808d3078f22c09872e73 | status: complete
2026-09-23 | task: RoleBadge after first login + RequireAuth blank screen fix | safe-point: ab56534 | status: complete
2026-09-23 | task: Auth isolation — move auth to landing page, platform-level session | safe-point: a834bca62e25cde734442f1df2d4fd7ce467c2b1 | status: complete
2026-09-23 | task: Task 7 — repo restructure: App→tools/cashflow, landing page, dual deploy workflows | safe-point: ace91bccff2b76840f8ce047039093046d7ba744 | status: complete
2026-09-23 | task: Task 5 — profile UI, soft-delete, GitHub Actions cleanup | safe-point: 71241d4c3512f3caf4c2460e698023cd87743795 | status: complete
2026-09-23 | task: UI polish — chart title clip, arrow clip, popup z-index + opacity | safe-point: cba0d37aa5d3db9b1d73bcde5d815fdf46404292 | status: complete
# Revert State — Safe Points

A safe-point commit hash is recorded here before every task that touches code.
If something goes wrong mid-session, revert to the recorded hash:

```bash
git reset --hard <hash>   # hard revert — discards all changes since safe-point
git revert <hash>         # soft revert — creates a new commit undoing changes
```

Use `git reset --hard` when the changes are local and not yet pushed.
Use `git revert` when changes have already been pushed to origin.

---

## Log

| Date | Task | Safe-point commit | Status |
|---|---|---|---|
| 2026-09-15 | Intelligence system build | a155128 | complete — no revert needed |
| 2026-09-20 | Rate limit granular flags + theme/UI polish | 113d051 | complete |
| 2026-09-15 | Manual review reload persistence + exit button | 49c97b1 | complete — no revert needed |
| 2026-09-16 | UserPreferences context, column resize persist, info popup, delete removal | c9c56ad | complete — no revert needed |
| 2026-09-16 | Preferences sync lifecycle, virtualizer height fix, CSS breakpoint sync | c9c56ad | complete — shipping to main |
| 2026-09-16 | Legal pages: /privacy, /terms, /accessibility, /cookies | 33ad764 | complete — no revert needed |
| 2026-09-17 | FilterPane order/persist bugs: remember order visibility, filter wipe on reload, stale buttons after nav | 53bd2ef | complete — no revert needed |
| 2026-09-17 | Manual review: decimal %, optimistic exit, spinner fallback, resolve-and-exit endpoint | 4e9d8f6 | complete — no revert needed |
| 2026-09-17 | Dashboard layout: info popup, data security page, viewport lock, chart height, bottom alignment | 39e4371 | complete — no revert needed |
| 2026-09-20 | App title centralised + renamed, dynamic font scaling (header + home), header flex layout, filter pane spacing/font, mobile pills routing fix, popup mobile scroll | e679c1e | complete — shipping to main |
| 2026-09-20 | Dashboard chart top spacing + manual review modal max-height scrollable + modal-card/modal-list desktop scroll fix | d70c5a3 | complete |
| 2026-09-21 | Auth & platform design session — no code changes, docs only | 924ac92 | complete |

| 2026-09-23 | task: Block 2b — hook scripts + ship skills + session-snapshot | 87f997d | complete |
| 2026-09-23 | task: discuss/execute skills + status-update enforcement + task-complete stats hook | 87f997d | complete |
| 2026-09-23 | task: rewrite build-intelligence for 3 cases + wire plugin/template repos + write setup guide | 8dc4701 | in-progress |
2026-09-23 | task: add step 0b to auth-design (rename breakage fixes) | safe-point: 93cc4f7 | status: complete
2026-09-23 | task: repo rename propagation (Cashflow2.0 -> utility-tools) | safe-point: f7e5385 | status: complete
2026-09-23 | task: Task 1 - email migration (backend + frontend) | safe-point: 35c42c9 | status: complete
2026-09-23 | task: Task 2 - Gmail SMTP email_service.py | safe-point: 71241d4 | status: complete
2026-09-23 | task: Tasks 3+4 - email verification + password reset + bot protection | safe-point: 71241d4 | status: in-progress
2026-09-23 | task: security audit fixes — rate limits, auth vulns, categorisation data integrity, dead code | safe-point: 7b38603 | status: complete
| 2026-09-24 | task: fix proxy IP rate limiting + ProxyFix + email flows | 5b8e64a3a4e2d946dddf3c925c47dd06acc33760 | in-progress |
2026-09-24 | task: admin panel — standalone Vite app + backend user-transactions endpoint | safe-point: 62020347eb442529747c1f9e7ac15464edaf98f6 | status: in-progress
