# Dev Task OMS

> **Full documentation: [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md)** (architecture, roles, data model,
> recurring tasks, reminders/cron, alert notifications, team board, reports, API list, env vars, deploy checklist).

Standalone copy of the DEV OMS "Task Assign & Follow-up" module (from `TASK_MODULE_EXPORT.md`).
Next.js 16 (App Router) + MongoDB + Tailwind 4. Auth is the DEV OMS scheme as-is.

## Setup

```bash
npm install
cp .env.example .env.local     # fill MONGODB_URI, ADMIN_FALLBACK_PASSWORD, SEED_PASSWORD
npm run seed                   # owner1 (boss), manager1 (taskManager), staff1/2 (team of manager1), staff3
npm run dev                    # http://localhost:3000/login
```

> **Run from a local drive** (e.g. `D:\DEV-TASK-OMS` on Dev-server, or a copy on your machine).
> From a `\\Dev-server\...` UNC path, `npm run` fails (cmd.exe can't use UNC cwd) and Next's
> Turbopack/webpack can't create their junctions/resolve loaders on a network share.
> Mapping the share to a drive letter (`net use Z: \\Dev-server\d`) also works.

## What's here vs. the export

- Everything marked ✅ in the export: tasks, status flow, verify/reject/reopen, checklist, comments,
  activity log, waiting/follow-up, stats, navbar badge, Alt+N global create, bulk actions, 409 locking.
- Urgent Tasks: API + `/dashboard/urgent-tasks` page (admin only). The full-screen popup exists but is
  **disabled** in `app/layout.tsx`, same as DEV OMS.
- Added since the export: departments, fixed/recurring tasks, holidays, seen + pause + work time, urgent
  auto-pause, PWA + alert notifications (Web Push) with a 5-minute reminder cron, team board, monthly reports
  (see PROJECT_DOCUMENTATION.md). `TaskFollowUp` is still schema-only.
- `/dashboard/settings`: minimal user page (create/edit/delete, `boss`, `taskManager`, `users`, `managerUsername`).

## Deviations from the export

- Hardcoded admins `admin` / `chintan` / `hitesh` log in with `ADMIN_FALLBACK_PASSWORD`. If it is empty,
  that login is disabled.
- `/api/login` uses the URI's default DB (`client.db()`), not a hardcoded `dev_oms_db`, so all code hits one DB.
- `POST /api/users` also saves `managerUsername` (DEV OMS only saved it on edit).
- User permissions trimmed to the three the module uses: `boss`, `taskManager`, `users`.
- Header nav (shown by permission): Tasks (with badge), Team + Fixed (manager/admin), Reports, Depts, Holidays,
  Urgent (admin), Alerts (everyone), Users (admin / `users` permission), logout.

## Auth (Phase 0 security fix)

- Passwords are bcrypt-hashed. Existing plain-text passwords: run `npm run migrate:passwords` once
  (idempotent; `-- --dry` to preview). A not-yet-migrated user is also hashed on their next login.
- `/api/login` sets an httpOnly, SameSite=Lax session cookie `oms_session` (signed JWT, 30 days,
  `SESSION_SECRET`). The cookie gets the `Secure` flag on HTTPS. On a plain-http LAN server it doesn't,
  because browsers drop Secure cookies over http.
- `getActor()` reads identity **only** from that cookie. `x-oms-user` / `?username=` / body username are ignored.
- `/api/users` (admin or `users` permission; only admin can grant/edit/delete `boss`; never returns passwords)
  and `/api/urgent-tasks` (create/list-all = admin, assignee acts on own tasks) are protected server-side.
- Login rate limit: 10 failed attempts / 15 min per username+IP (`login_attempts` collection, TTL index).
- `localStorage.oms_user` is a display cache only, refreshed from `GET /api/me`. `POST /api/logout` clears the cookie.
