# Dev Task OMS — Project Documentation

A task assignment and follow-up system for the office team: give tasks, track who is working on what,
fixed (recurring) work, urgent work, alert notifications (phone / computer push), team board and monthly reports.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, MongoDB with Mongoose 8, Tailwind CSS 4.
All date logic uses **IST (Asia/Kolkata)**. User-facing messages are in Hinglish.

---

## 1. Rules every change must follow

| Rule | How |
|---|---|
| Thin routes | `app/api/**/route.ts`: `getActor(req)` → **one** service function → `respond()` (`lib/tasks/http.ts`). No business logic in routes. |
| Identity | `getActor()` (`lib/tasks/permissions.ts`) reads the user **only** from the signed `oms_session` cookie. Permissions are re-read from the DB on every request. |
| Errors | `throw new TaskError(status, "Hinglish message")`. `respond()` turns it into `{ error }` JSON. |
| Activity log | Every change to a task writes a row in `task_activities` (`logActivity()` in `taskService.ts`). `by: null` = system (cron, auto-pause, recurring). |
| Optimistic locking | Task updates filter on the loaded `updatedAt` (`applyUpdate()`). A conflict gives 409 "Task kisi aur ne update kiya hai, refresh karo". Background writes (reminders) use `{ timestamps: false }` so they never cause false 409s. |
| IST dates | Use `lib/tasks/ist.ts` (`istDateKey`, `istDayBounds`, `istDateTime`, …). Calendar days are `"YYYY-MM-DD"` strings. Never use the server's local timezone. |
| Reuse schema fields | `Task.recurrence`, `escalationLevel`, `lastReminderAt`, `TaskSettings` are used; don't add duplicates. |
| Idempotency | Recurring generation (unique partial index) and reminders (unique `reminder_log.key`) can run any number of times safely. |

## 2. Folder map

```
app/api/...                 thin route files (list in section 8)
app/dashboard/tasks         main task list, drawer, create modal (components/)
app/dashboard/team-board    live team view          (manager + admin)
app/dashboard/reports       monthly report + CSV    (admin)
app/dashboard/templates     fixed / recurring tasks (manager + admin)
app/dashboard/departments   departments             (admin)
app/dashboard/holidays      holidays                (admin)
app/dashboard/notifications Alerts: push on/off + test, work hours (everyone; work hours = admin)
app/dashboard/settings      users page              (admin or `users` permission)
app/dashboard/urgent-tasks  old urgent module (kept, admin)

lib/auth/       password (bcrypt), session (JWT cookie), rate limit, client session helpers
lib/tasks/      taskService (lifecycle), templateService (recurring), recurrence (pure rules),
                orgService (departments/holidays), reportService (board + reports), permissions, ist, types
lib/notify/     push, notify() entry point, workHours, taskAlerts (instant alerts),
                reminderService (cron tick), notifyService (settings page API), client (browser push)
lib/users/      userService (users page API)
models/         Mongoose models (section 4)
public/         sw.js (service worker), manifest.webmanifest, icons/
scripts/        seed, password migration, VAPID keys, icons, local cron
```

## 3. Roles and permissions

User permission flags (in `users.permissions`): `boss` = **admin**, `taskManager` = **manager**, otherwise **staff**.
`users` = may open the Users page.

| | Staff | Manager | Admin |
|---|---|---|---|
| See tasks | own + watching | self + team (users with `managerUsername` = me). **No team set = sees everybody** | all |
| Assign | only to self | self + team | anyone |
| Verify / Reject / Reopen / Cancel / Reassign | – | ✓ | ✓ |
| Fixed tasks (templates) | – | ✓ (users only) | ✓ (+ departments) |
| Team board | – | ✓ (own team) | ✓ (all) |
| Reports, Departments, Holidays, Work hours | – | – | ✓ |

**Hardcoded admins** `admin` / `chintan` / `hitesh`: they are not in the DB. They log in with `ADMIN_FALLBACK_PASSWORD`, and the JWT gets `fa: true`.
- They work only while that env var is set.
- A DB user with the same name gets **no** admin rights from the name.
- These names cannot be created on the Users page.

## 4. Data model (MongoDB collections)

| Collection | Model | Notes |
|---|---|---|
| `users` | `models/User.js` (reference; accessed via the driver) | `username`, bcrypt `password`, `permissions`, `managerUsername`, `department` |
| `tasks` | `models/Task.ts` | see below |
| `task_activities` | `TaskActivity.ts` | `taskId, by, type, text, from, to`. Types include CREATED, STATUS_CHANGED, SEEN, PAUSED, RESUMED, ESCALATED, … |
| `task_templates` | `TaskTemplate.ts` | fixed/recurring work: `recurrence {type, daysOfWeek, datesOfMonth, monthDay, leadDays, holidayShift}`, `assignees`, `departments`, `dueTime` |
| `departments` | `Department.ts` | seeded: Accounts, Link Generator, Order Entry, Dispatch, Bid |
| `holidays` | `Holiday.ts` | `date` "YYYY-MM-DD" (unique) |
| `task_settings` | `TaskSettings.ts` | single doc `_id: "default"`: `workStartHour`, `workEndHour`, `workingDays` (other fields are old schema-only) |
| `push_subscriptions` | `PushSubscription.ts` | one per browser/device (`endpoint` unique), removed on 404/410 or logout |
| `reminder_log` | `ReminderLog.ts` | unique `key` per sent alert (dedupe), TTL 90 days |
| `counters` | `Counter.ts` | task numbers (`TSK-YYMM-0001`), lazy-run throttle |
| `login_attempts` | (driver) | login rate limit, TTL 15 min |
| `urgenttasks` | `UrgentTask.ts` | old urgent module, untouched |

**Task fields (important ones)**
- `taskNo`, `title`, `description`, `category`, `priority`, `status`
- `assignedBy`, `assignee`, `watchers` (all plain usernames)
- `dueAt`, `startedAt`, `completedAt`, `closedAt`
- `waitingOn`, `nextFollowUpAt`, `checklist[]`
- `seenAt`: the assignee opened or acknowledged the task.
- `workSessions [{start, end, pauseReason}]` and `totalWorkSeconds`: the exact work time.
- `source`: WEB / RECURRING / …
- `recurrence.templateId` + `recurrence.occurrenceDate`: set on tasks generated from a template. A unique partial index on these makes generation idempotent.
- `escalationLevel`, `lastReminderAt`: written by the reminders.
- `isDeleted`: soft delete.

## 5. Task lifecycle

```
OPEN ──Start──► IN_PROGRESS ──Pause(reason)──► PAUSED ──Resume──► IN_PROGRESS
  │                 │  ▲                          │
  │                 ▼  │Resume                    ├──► WAITING / DONE / CANCELLED
  │              WAITING (waitingOn + nextFollowUpAt)
  ▼                 │
CANCELLED (reason)  ▼
                  DONE ──Verify──► CLOSED ──Reopen(reason)──► OPEN
                    └──Reject(reason)──► IN_PROGRESS
```
The exact list is `ALLOWED_TRANSITIONS` in `lib/tasks/types.ts`.

- If verification is not required, **Done → Closed** happens automatically.
- **Work time:**
  - Start, Resume and Reject open a work session.
  - Pause, Waiting, Done and Cancel close it.
  - Only closed sessions are added to `totalWorkSeconds`. The UI adds the running session live.
- **Seen:**
  - Set the first time the assignee opens the drawer, taps "Dekh liya", or acts on the task.
  - Self-assigned tasks count as seen.
  - "Not seen" is shown only for OPEN tasks.
- **Urgent:** when a task becomes URGENT for its assignee, `pauseForUrgent()` auto-pauses that person's other **non-urgent** IN_PROGRESS tasks.
  - Triggers: created, priority raised to URGENT, reassigned, reopened, or an urgent fixed task is generated.
  - The pause reason is "Urgent task aaya: <taskNo>".
  - It logs a PAUSED activity (by system) and sends an instant alert (push).
  - Active urgent tasks always sort on top and are highlighted red.

## 6. Fixed (recurring) tasks

- Templates are defined on `/dashboard/templates`. The rules are pure functions in `lib/tasks/recurrence.ts`.
- **Repeat types:** Daily (on working days), Weekly (days), Monthly (dates; "last" = last day; 31 in a short month = last day), Yearly (29 Feb → 28 Feb).
- **Holidays and non-working days:** Daily skips them. Weekly, monthly and yearly shift to the previous or next working day (`holidayShift`).
- **Lead days:** `leadDays` creates the task earlier. `occurrenceDate` is the nominal rule date, used as a stable id.
- **`generateRecurringTasks(dateIST)`** creates one task per assignee + department member and occurrence.
  - It runs from the cron at 00:05 IST.
  - It also runs lazily when the tasks page opens (`POST /api/tasks/recurring`, at most once per 10 min).
  - It also runs right after a template is saved.
- Working days come from `TaskSettings.workingDays` (default Mon–Sat) plus the `holidays` collection.

## 7. Alert notifications and reminders (Phase 4)

**Channel: alert notifications only (Web Push).** There is no WhatsApp, SMS or email; WhatsApp was removed on request.
- `lib/notify/push.ts` (VAPID) sends to every subscribed device of the user. A tap opens `/dashboard/tasks?task=<id>`.
- `notify(username, {title, body, url})` in `lib/notify/index.ts` is the single entry point. It never throws.

**PWA**
- `public/manifest.webmanifest` and `public/sw.js` handle `push` and `notificationclick`.
- The banner `components/NotifyBanner.tsx` offers "Notifications ON karo", an install button, and the iPhone "Add to Home Screen" hint. iOS push works only from the Home Screen app (iOS 16.4+).
- Logout removes the device's subscription.

**Instant alerts** (`lib/notify/taskAlerts.ts`)
- **New task** for someone else → push the assignee (during work hours; otherwise the cron sends it when work starts).
- **Urgent** → push to the assignee immediately (stays on screen until tapped).

**Cron tick** (`lib/notify/reminderService.ts`): `POST /api/cron/tick` every 5 minutes.

| When | Who | Channel | Sent once per |
|---|---|---|---|
| 00:05 IST | – (generate fixed tasks) | – | day |
| New task not yet notified | assignee | push | task + assignee |
| OPEN, not seen 30 min (counted from work start for older tasks) | assignee + assigner + manager | push | task |
| Due in ≤ 30 min | assignee | push | task + due time |
| Overdue | assignee | push | task + day |
| Overdue | assigner + manager | push, `escalationLevel++`, ESCALATED activity | task + due time |
| WAITING and `nextFollowUpAt` reached | assignee | push | task + follow-up time |
| 19:00 IST on working days | admins | push summary | day |

- Every send first inserts a unique `reminder_log.key` (the "claim"). Parallel or repeated ticks therefore never send twice.
- Sends also stamp `lastReminderAt`.
- Non-urgent reminders go out only inside work hours: `TaskSettings` start/end hour on working days that are not holidays. **URGENT ignores work hours.**

**Running the cron**
- **Local / office server:** run `npm run cron:local` and keep it running (pm2 or Windows Task Scheduler is fine).
- **Vercel / external:** call `/api/cron/tick` every 5 min with either header:
  - `x-cron-secret: <CRON_SECRET>` (POST)
  - `Authorization: Bearer <CRON_SECRET>` (GET, the Vercel Cron format)
- Vercel Hobby crons may run only once a day, so use an external cron service (e.g. cron-job.org) there.

## 8. API reference

All routes need the session cookie unless noted. The **Who** column shows who may call each route.

| Method + path | Who | Purpose |
|---|---|---|
| POST `/api/login` | public | login, sets cookie (rate limited) |
| POST `/api/logout`, GET `/api/me` | any | logout / who am I |
| GET/POST `/api/users`, PUT/DELETE `/api/users/[id]` | admin / `users` | users page (never returns passwords) |
| GET/POST `/api/tasks` | any | list (`view, status, priority, kind, stat, q, sort, page`) / create (`assignee` \| `assignees[]` \| `departmentId`) |
| GET `/api/tasks/summary`, `/pending-count`, `/users` | any | stats cards, navbar badge, assignable users |
| GET/PATCH/DELETE `/api/tasks/[id]` | per task | detail + activities / edit / soft delete |
| POST `/api/tasks/[id]/status` `{status, reason?, waitingOn?, nextFollowUpAt?}` | assignee / mgr | lifecycle |
| POST `/api/tasks/[id]/assign`, `/verify`, `/reject`, `/reopen` | mgr | management actions |
| POST `/api/tasks/[id]/comments`, `/seen` | per task / assignee | comment / mark seen |
| POST `/api/tasks/recurring` | any | lazy fixed-task generation |
| GET/POST `/api/templates`, PATCH/DELETE `/api/templates/[id]`, POST `/api/templates/preview` | mgr | fixed tasks |
| GET/POST `/api/departments`, PATCH `/api/departments/[id]` | GET any, write admin | departments |
| GET/POST `/api/holidays`, DELETE `/api/holidays/[id]` | GET any, write admin | holidays |
| GET/PATCH `/api/notifications/settings` | any (`work` = admin) | push status, my device count, work hours |
| POST `/api/notifications/test` | any | test alert to my own devices |
| POST/DELETE `/api/push/subscribe` | any | save / remove this browser's subscription |
| POST/GET `/api/cron/tick` | **cron secret** | reminders tick |
| GET `/api/team-board` | mgr | live board |
| GET `/api/reports/monthly?month=YYYY-MM` | admin | monthly report |
| GET/POST `/api/urgent-tasks`, PATCH `/[id]` | admin / assignee | old urgent module |

## 9. Team board and reports (Phase 5)

**Team board** (`/dashboard/team-board`, auto-refresh every 30 s, paused while the tab is hidden). One card per person:
- **State:** Working (with live timer), Paused (with reason), or Idle (with the next task).
- **Counts:** urgent, overdue, not seen, open, paused, waiting, done today.
- **Today's work time.**
- Cards are sorted urgent first, then working, then by overdue.
- Filters: department, search, "problems only".

**Monthly report** (`/dashboard/reports`, admin). Per user and per department, plus a total row. All counts are for the chosen IST month:

| Column | Meaning |
|---|---|
| Assigned | created in the month |
| Due | due in the month |
| Done | completed in the month |
| On-time % | share of Done tasks finished on or before the due date |
| Pending overdue | due in the month and still not done |
| Rejected | rework count |
| Fixed tasks | done / due |
| Work time | logged inside the month |
| Avg time | from creation to Done |

CSV export downloads the current tab. It is UTF-8 with a BOM so Excel opens it correctly, and formula characters are escaped.

## 10. Environment variables

See `.env.example`.

| Var | Needed | Notes |
|---|---|---|
| `MONGODB_URI` | yes | DB name in the URI path |
| `SESSION_SECRET` | yes | ≥ 32 chars (`npm run gen:secret`). Changing it logs everyone out. |
| `ADMIN_FALLBACK_PASSWORD` | optional | empty = hardcoded admins disabled |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push | `npm run gen:vapid`, **once**. New keys mean everyone must re-enable notifications. |
| `CRON_SECRET` | for reminders | protects `/api/cron/tick` |
| `APP_URL` | optional | target for `cron:local` |
| `SEED_PASSWORD` | seed only | |

## 11. Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | test users |
| `npm run migrate:passwords` | hash old plain-text passwords (idempotent, `-- --dry`) |
| `npm run gen:secret` | random secret for `SESSION_SECRET` / `CRON_SECRET` |
| `npm run gen:vapid` | Web Push key pair |
| `npm run gen:icons` | regenerate PWA icons in `public/icons` |
| `npm run cron:local` | call the reminders tick every 5 min |

## 12. Deploy checklist

1. Set all env vars (section 10) on the server or Vercel.
2. Run `npm run migrate:passwords` once against the production DB.
3. Set up the 5-minute cron (section 7).
4. Use HTTPS: push and PWA install need it (localhost is the only exception). The session cookie gets `Secure` automatically on HTTPS.
5. Each user opens **🔔 Alerts** → "Notifications ON karo" on every phone and computer they use.

## 13. Known limits / notes

- Work time exists only for tasks started after Phase 2. Older in-progress tasks start counting from their next Start or Resume.
- WhatsApp alerts were built and then removed on request. Old schema fields stay unused: `TaskSettings.whatsappEnabled` / `whatsappMaxPerMinute`, and any `phone` / `whatsappAlerts` values already saved on users.
- `TaskSettings.holidays` (Date array) is superseded by the `holidays` collection. `TaskFollowUp` is still schema-only.
- In dev mode the Task and TaskActivity models are re-created on hot reload so schema changes apply. If Turbopack shows `ComponentMod.handler is not a function`, stop the server, delete `.next` and restart.
