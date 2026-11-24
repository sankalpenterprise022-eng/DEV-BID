# Dev Task OMS

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
- Schema-only models: `TaskFollowUp`, `TaskSettings`, plus `Task.recurrence / escalationLevel / ...`.
  No cron, reminders, WhatsApp or escalation logic (not built in DEV OMS either).
- `/dashboard/settings`: minimal user page (create/edit/delete, `boss`, `taskManager`, `users`, `managerUsername`).

## Deviations from the export

- Hardcoded admins `admin` / `chintan` / `hitesh` log in with `ADMIN_FALLBACK_PASSWORD`. If it is empty,
  that login is disabled.
- `/api/login` uses the URI's default DB (`client.db()`), not a hardcoded `dev_oms_db`, so all code hits one DB.
- `POST /api/users` also saves `managerUsername` (DEV OMS only saved it on edit).
- User permissions trimmed to the three the module uses: `boss`, `taskManager`, `users`.
- Header is a small nav: Tasks (with badge), Urgent (admin), Users (admin / `users` permission), logout.

## Known security gaps (kept as-is on purpose)

Plain-text passwords; identity = `x-oms-user` header (forgeable); `/api/users` and `/api/urgent-tasks`
have no auth and `/api/users` returns passwords. See export section 4.
