# Dev Task OMS — Testing Guide (Phase by Phase)

Simple step-by-step checks for everything built in Phase 0 to Phase 5.
Do the steps in order. After each step, check the **✅ Result**. If it matches, tick the box `[x]`.
If it does not match, write down the step number, take a screenshot, and report it (format at the end).

---

## A. Before you start (one time)

### A1. Setup checklist
- [ ] `.env.local` has: `MONGODB_URI`, `SESSION_SECRET` (`npm run gen:secret`)
- [ ] For Phase 4: the 3 VAPID lines (`npm run gen:vapid`), `CRON_SECRET` (`npm run gen:secret`)
- [ ] Ran `npm run migrate:passwords` once
- [ ] Restarted the app: `Ctrl+C` → `rmdir /s /q .next` → `npm run dev`
- [ ] Phase 4 only: second terminal running `npm run cron:local` (keep it open)

### A2. Test users

| User | Role | Use it for |
|---|---|---|
| **Admin** | Admin (boss) | creates tasks, reports, settings |
| **Piyush** | Manager (taskManager) | team member who works on tasks; also manager tests |
| **Vijay** | Staff (has Users page access) | staff limits |
| **TestStaff** | Staff, no permissions | you create it in step 0.6 |

### A3. Two users at the same time
Use **two browsers**: e.g. Chrome for Admin and Edge (or a Chrome *Incognito* window) for Piyush.
One browser = one logged-in user.

### A4. Words used in this guide
- **Drawer** = the side panel that opens when you click a task row.
- **Header** = the dark blue bar at the top (Tasks, Team, Fixed, Alerts, …).
- **Toast** = the small message at the bottom of the screen.

---

## PHASE 0 — Login & Security

**What is new:** passwords are stored safely (hashed), login uses a secure cookie for 30 days,
too many wrong passwords block login for 15 minutes, users page is protected.

| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 0.1 | Correct login | Open `/login`, log in as **Admin** | Tasks page opens | [ ] |
| 0.2 | Wrong password | Log out. Log in as Admin with a wrong password | Message **"Username ya password galat hai"** | [ ] |
| 0.3 | Login stays | Log in, close the browser fully, open again → `/dashboard/tasks` | Still logged in (no login page) | [ ] |
| 0.4 | Logout | Click the logout icon (top right) | Login page opens. Pressing *Back* does not show tasks | [ ] |
| 0.5 | Too many wrong tries | Use a test user. Enter a wrong password **11 times** | Message **"Bahut zyada galat try ho gaye, … min baad dobara try karo"**. Even the right password is blocked for ~15 min | [ ] |
| 0.6 | Create user | Admin → **Users** → New user `TestStaff`, password `test1234`, no boxes ticked → Create | "User ban gaya". Row shows role **Staff** | [ ] |
| 0.7 | Password hidden | On the Users page click ✏️ Edit on any user | Password box is **empty** (password never shown) | [ ] |
| 0.8 | Edit without password | Edit TestStaff, change nothing in password, Update. Log in as TestStaff with `test1234` | Login works (old password kept) | [ ] |
| 0.9 | Reserved name | Users → New user named `admin` | Error **"\"admin\" naam reserved hai"** | [ ] |
| 0.10 | Cannot delete self | As Admin, try to delete the **Admin** row | Error **"Apna khud ka account delete nahi kar sakte"** | [ ] |
| 0.11 | Staff blocked from Users | Log in as **TestStaff** | No **Users** link in header. Opening `/dashboard/settings` shows "You have no access" | [ ] |
| 0.12 | Session expired | While logged in, delete the cookie (or wait until expiry) and click anything | You go to the login page automatically | [ ] |

---

## PHASE 1 — Departments, Fixed (repeating) tasks, Holidays, Multi-assign

**What is new:** departments, fixed tasks that create themselves (daily / weekly / monthly / yearly),
holidays, giving one task to many people or a whole department.

### 1A. Departments (Admin)
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 1.1 | Default departments | Header → **Depts** | Accounts, Bid, Dispatch, Link Generator, Order Entry are listed | [ ] |
| 1.2 | Add department | Type `Purchase` → add | "Department ban gaya", new row | [ ] |
| 1.3 | Put user in department | Users → Edit **Piyush** → Department = Accounts → Update | Users table shows Accounts. Depts page shows Piyush under Accounts members | [ ] |
| 1.4 | Turn department off | Depts → turn **Purchase** off | Status shows off ("Department band kiya") | [ ] |
| 1.5 | Not for others | Log in as Piyush or Vijay | No **Depts** / **Holidays** link in header | [ ] |

### 1B. Holidays (Admin)
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 1.6 | Add holiday | Header → **Holidays** → pick **tomorrow's date**, name `Test Holiday` → add | Holiday appears in list | [ ] |
| 1.7 | Same date twice | Add the same date again | Error (date already exists) | [ ] |
| 1.8 | Delete holiday | Delete it (do this **after** test 1.13) | Removed from list | [ ] |

### 1C. Many people at once (Create Task)
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 1.9 | Many users | Admin → **New Task** → Assign to: **Piyush + Vijay** → Save | Toast **"2 tasks ban gaye (har ek ka alag)"**. Two rows, different task numbers | [ ] |
| 1.10 | Whole department | New Task → switch to **Department** → Accounts → Save | One task for **each** member of Accounts | [ ] |
| 1.11 | Staff limit | Log in as **TestStaff** → New Task | Can only give task to self (no user/department picker) | [ ] |

### 1D. Fixed tasks (templates) — Header → **Fixed**
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 1.12 | Daily template | New → Title `Daily bank entry`, Users: Piyush, Repeat **Daily**, Due time 18:00 → click **Preview** → Save | Preview shows next 5 dates (Sundays skipped). Toast "Template ban gaya". Today's task is created at once | [ ] |
| 1.13 | Holiday skip | Look at Preview of the daily template | **Tomorrow (Test Holiday)** is **not** in the list | [ ] |
| 1.14 | Weekly | New → Repeat **Weekly** → tick Mon + Thu → Preview | Only Mondays and Thursdays | [ ] |
| 1.15 | Monthly + last day | Repeat **Monthly** → pick **31** and **Last day** → Preview | Feb shows 28/29 (not skipped). No duplicate date | [ ] |
| 1.16 | Sunday shift | Monthly on a date that falls on a Sunday → "Sunday / holiday aaye to" = **Pichhle working day** → Preview | Date moves to the Saturday before | [ ] |
| 1.17 | Shift next | Same, choose **Agle working day** | Date moves to the Monday after | [ ] |
| 1.18 | Yearly | Repeat **Yearly** → Month Feb, Date 29 → Preview | Non-leap years show **28 Feb** | [ ] |
| 1.19 | Create early | Set **Kitne din pehle banaye** = 2 → Save | Task for 2 days later is already created today | [ ] |
| 1.20 | Department template (admin) | Template with Departments: Accounts | Every Accounts member gets their own task | [ ] |
| 1.21 | No double tasks | Open Tasks page, refresh 3–4 times | Fixed task appears **only once** per person per day | [ ] |
| 1.22 | Turn template off | Fixed → toggle Active off | "Band kiya". No new tasks from it | [ ] |
| 1.23 | Badges | Tasks list | Fixed tasks show a badge 🔁 / 📅 / 🗓️, normal tasks 📌 | [ ] |
| 1.24 | Kind filter | Tasks → filter **Recurring** / **Assigned** | Shows only that kind | [ ] |
| 1.25 | Staff no access | TestStaff opens `/dashboard/templates` | "You have no access" | [ ] |

---

## PHASE 2 — Seen, Pause, Work time

**What is new:** know if a person **opened** the task, **Pause** with a reason, exact **work time**
(pause time not counted), progress bar.

| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 2.1 | Not seen | Admin creates a task for Piyush with 2 checklist items | Piyush's row shows red **"Not seen"**. Card **Not Seen** = 1 or more | [ ] |
| 2.2 | Dekh liya button | Piyush logs in | Row shows **👁 Dekh liya** button. Tap it → chip disappears | [ ] |
| 2.3 | Open = seen | (another task) Piyush just opens the task drawer | Admin's view: "Not seen" gone. Activity shows "Task dekh liya" | [ ] |
| 2.4 | Self task | Admin creates a task for **Admin** | No "Not seen" chip | [ ] |
| 2.5 | Start | Piyush clicks **Start** | Green blinking **"Working now"**. Drawer: Started at filled, Work time counting | [ ] |
| 2.6 | Pause without reason | Click **⏸ Pause** → Confirm with empty reason | Error, reason is required | [ ] |
| 2.7 | Pause with reason | Choose chip **Lunch / break** → Confirm | Status **Paused** (orange). Pause history "⏸ Lunch / break" | [ ] |
| 2.8 | Pause time not counted | Wait 2 minutes → **▶ Resume** | Work time did **not** grow during those 2 minutes | [ ] |
| 2.9 | Wrong move | On an **Open** (not started) task | No Pause button (only after Start) | [ ] |
| 2.10 | From Paused | Pause again → check buttons | Can go Resume / Waiting / Done / (manager) Cancel | [ ] |
| 2.11 | Checklist % | Tick 1 of 2 items | Table progress bar **50%**, drawer "1/2 · 50%" | [ ] |
| 2.12 | Done | **Mark Done** | Completed at filled, work time stops, ⏱ total shows in table | [ ] |
| 2.13 | Filters | Admin → click **Paused** card / status filter PAUSED | Only paused tasks | [ ] |
| 2.14 | Waiting stops timer | Start a task → **Waiting** (choose who + follow-up date) | Timer stops; Resume starts it again | [ ] |

---

## PHASE 3 — Urgent tasks

**What is new:** when a task becomes **URGENT**, the person's running work is **auto-paused**;
urgent tasks are **always on top in red**.

| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 3.1 | Setup | Admin gives Piyush a **Normal** task "Test A". Piyush clicks **Start** | Test A = Working now | [ ] |
| 3.2 | Urgent auto-pause | Admin creates **Urgent** task "Test B" for Piyush | Toast shows **"⏸ Auto-pause: TSK-… (Piyush)"** | [ ] |
| 3.3 | Old task paused | Piyush checks "Test A" | Status **Paused**. Pause history: **"Urgent task aaya: TSK-…"** | [ ] |
| 3.4 | Red + top | Piyush's task list | Test B is **first row**, red background, 🚨, blinking URGENT chip | [ ] |
| 3.5 | Drawer banner | Open Test B | Red banner **"URGENT task - baaki kaam rok kar ye pehle karo"** | [ ] |
| 3.6 | Top in any sort | Change sort to Newest | Urgent still on top | [ ] |
| 3.7 | Priority change | Piyush starts a normal task. Admin opens another Piyush task → Priority = **Urgent** | Piyush's running task gets paused | [ ] |
| 3.8 | Urgent does not pause urgent | Piyush starts urgent Test B. Admin creates another urgent task for Piyush | Test B **stays** In Progress | [ ] |
| 3.9 | Reassign urgent | Admin reassigns an urgent task to Vijay while Vijay is working on something | Vijay's running task gets paused | [ ] |
| 3.10 | Resume after | Piyush finishes Test B (Done) → opens Test A → **▶ Resume** | Test A works again; time spent on B not added to A | [ ] |
| 3.11 | Done urgent not red | After Test B is Done/Closed | No red highlight anymore | [ ] |
| 3.12 | Old Urgent page | Header → **Urgent** (admin) | Old urgent module still works as before | [ ] |

---

## PHASE 4 — App install, Alert notifications, Reminders

**What is new:** install as an app, alert pop-ups on phone/computer (no WhatsApp),
automatic reminders every 5 minutes. Settings in Header → **🔔 Alerts**.

> Needs A1 setup (VAPID keys, CRON_SECRET, `npm run cron:local` running).
> Push needs **https** or **localhost**. On a phone, use the https (Vercel) link.

### 4A. Turn on notifications
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 4.1 | Banner | Log in (computer, Chrome/Edge) | Orange strip **"Notifications ON karo"** under header | [ ] |
| 4.2 | Turn on | Click it → **Allow** | Strip disappears. Alerts page: "✅ Is device par alerts ON hain" | [ ] |
| 4.3 | Test alert | Alerts → **Test alert bhejo** | Pop-up **"🔔 Test notification"** | [ ] |
| 4.4 | Blocked | In another browser click **Block** on the permission pop-up | Strip says notifications blocked + how to Allow | [ ] |
| 4.5 | Snooze | Click ✖ on the strip | Strip hidden for 3 days | [ ] |
| 4.6 | Android install | Phone Chrome → open the app link | "App install" button or Chrome menu → **Install app**. Opens full screen with orange ✔ icon | [ ] |
| 4.7 | iPhone | iPhone Safari → open link | Strip says: Share → **Add to Home Screen**. After that, open from Home Screen → Notifications ON works | [ ] |
| 4.8 | Each device | Turn on in phone **and** computer | Alerts page shows "2 device(s)" | [ ] |

### 4B. Turn off
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 4.9 | Turn off on one device | Alerts → **OFF karo** | "Is device par alerts OFF". That device gets no more alerts; other devices still do | [ ] |
| 4.10 | Turn on again | Alerts → **Notifications ON karo** | ON again, device count goes back up | [ ] |
| 4.11 | No WhatsApp anywhere | Look at Alerts page and Users page (edit a user) | **No** phone / WhatsApp fields anywhere | [ ] |

### 4C. Instant alerts (Piyush has notifications ON)
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 4.14 | New task | Admin creates a Normal task for Piyush (during work hours) | Piyush gets **"🆕 Naya task: …"** | [ ] |
| 4.15 | Tap opens task | Tap the notification | App opens with **that task's drawer** open | [ ] |
| 4.16 | Urgent | Admin creates an **Urgent** task for Piyush | 🚨 alert that **stays on screen until tapped** | [ ] |
| 4.17 | Own task | Piyush creates a task for himself | **No** notification | [ ] |
| 4.18 | Logout stops push | Piyush logs out on that device. Admin creates a task for Piyush | That device gets **no** push | [ ] |

### 4D. Automatic reminders (cron window must be running; wait up to 5 min each)
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 4.19 | Cron running | Look at the `cron:local` window | Lines like `[time] ok (work hours) …` every 5 min | [ ] |
| 4.20 | Due soon | Task for Piyush due in **20 min** | Push **"⏰ … min mein due"** | [ ] |
| 4.21 | Overdue | Admin creates task for Piyush with due time **in the past** | Piyush: **"🔴 Overdue"**. Admin: **"⚠️ Overdue: Piyush ka task"**. Task history: "Overdue alert bheja" | [ ] |
| 4.22 | Only once | Wait for the next 2 cron runs | Same overdue alert is **not** sent again (assignee gets max 1 per day) | [ ] |
| 4.23 | Not seen 30 min | Task for Piyush, Piyush does **not** open it for 30+ min | Piyush: "👀 Task abhi tak dekha nahi". Admin: "👀 Piyush ne task nahi dekha" | [ ] |
| 4.24 | Follow-up | Piyush: Start → **Waiting** with follow-up time 2 min from now | After it passes: **"📞 Follow-up ka time"** | [ ] |
| 4.25 | Work hours | Admin → Alerts → set work hours so **now is outside** (e.g. 10 AM–11 AM) → Save. Create a Normal overdue task | **No** reminder. Urgent tasks **still** alert | [ ] |
| 4.26 | Restore hours | Set back 10 AM – 7 PM, Mon–Sat → Save | Saved | [ ] |
| 4.27 | Non-admin can't change hours | Piyush → Alerts | Work hours shown but **disabled** ("Sirf admin badal sakta hai") | [ ] |
| 4.28 | Daily summary | Keep cron running past **7:00 PM** on a working day | Admin gets **"📊 Aaj ka summary"** alert (once) | [ ] |
| 4.29 | Fixed tasks at night | Keep cron running past **00:05** | Next morning, today's fixed tasks exist (also check cron log `recurring created=…`) | [ ] |

---

## PHASE 5 — Team Board & Monthly Reports

**What is new:** live board of who is working on what (manager/admin),
monthly report per user and department with CSV (admin).

### 5A. Team Board — Header → **Team**
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 5.1 | Working card | Piyush starts a task. Admin opens Team | Piyush card: 🟢 **Working**, task name, timer moving every second | [ ] |
| 5.2 | Auto refresh | Piyush **Pauses** with a reason. Admin does nothing | Within 30 sec card becomes 🟠 **Paused** with the reason | [ ] |
| 5.3 | Idle | Person with no running task | ⚪ **Idle** + "Next:" task (or "Koi pending kaam nahi") | [ ] |
| 5.4 | Red / amber border | Person with an urgent task / overdue task | Red border (urgent), amber border (overdue) | [ ] |
| 5.5 | Counts | Compare chips with that person's tasks | Urgent / Overdue / Not seen / Open / Paused / Waiting / Done aaj match | [ ] |
| 5.6 | Today's work | Bottom of card | "Aaj ka kaam" grows while working | [ ] |
| 5.7 | Filters | Search a name; choose a department; tick "Sirf problem wale" | List filters correctly | [ ] |
| 5.8 | Open task | Click a task in a card | Tasks page opens with that task | [ ] |
| 5.9 | Manager sees team only | Give TestStaff manager = Piyush (Users page). Log in as Piyush → Team | Piyush sees **himself + his team** only | [ ] |
| 5.10 | Staff blocked | TestStaff / Vijay | No **Team** link; page shows "sirf manager/admin" | [ ] |

### 5B. Reports — Header → **Reports** (Admin)
| # | Scenario | Steps | ✅ Result | Done |
|---|---|---|---|---|
| 5.11 | Open report | Reports → this month | Cards + table per user + **Total** row | [ ] |
| 5.12 | Totals add up | Add each column of users | Equals the Total row | [ ] |
| 5.13 | Done counts | Piyush marks a task Done → refresh report | Piyush **Done +1**, On time % updates | [ ] |
| 5.14 | Late task | Complete a task **after** its due time | Counts as late (On time % goes down) | [ ] |
| 5.15 | Department tab | Click **Per department** | Department totals (Accounts etc.) | [ ] |
| 5.16 | Old month | Pick a month with no data | Zeros / "Is mahine koi data nahi" | [ ] |
| 5.17 | Sort | Click a column header (e.g. Done) twice | Sorts high→low, then low→high | [ ] |
| 5.18 | CSV | Click **CSV export** → open in Excel | File `task-report-YYYY-MM-users.csv`, columns correct, names readable | [ ] |
| 5.19 | Not for manager | Piyush opens `/dashboard/reports` | "Reports sirf admin ke liye hain." | [ ] |

---

## OLD FEATURES — make sure nothing broke

| # | Scenario | ✅ Result | Done |
|---|---|---|---|
| R.1 | Create task with Alt+N | New task window opens | [ ] |
| R.2 | Comment in drawer | Comment saved, shows in activity | [ ] |
| R.3 | Watchers (CC) | Watcher sees task in "Watching" view | [ ] |
| R.4 | Done → Verify (manager) | Task becomes Closed | [ ] |
| R.5 | Reject with reason | Back to In Progress, timer starts again | [ ] |
| R.6 | Reopen closed task | Back to Open | [ ] |
| R.7 | Reassign | New person gets it; old person becomes watcher | [ ] |
| R.8 | Bulk select → set priority / reassign | Works on all selected | [ ] |
| R.9 | Same task edited in 2 browsers | Second save shows **"Task kisi aur ne update kiya hai, refresh karo"** | [ ] |
| R.10 | Header Tasks badge | Shows pending count, updates | [ ] |
| R.11 | Search box | Finds by task no / title | [ ] |
| R.12 | Mobile screen | Tasks page and drawer usable on phone | [ ] |

---

## After testing — clean up
- [ ] Delete test tasks (drawer → delete, admin)
- [ ] Delete test holiday, turn off / delete test templates
- [ ] Delete user **TestStaff** (or keep for future tests)
- [ ] Work hours back to normal (4.26)

## How to report a problem
```
Step no:      (e.g. 3.2)
User:         (Admin / Piyush / ...)
Device:       (Laptop Chrome / Android Chrome / iPhone app)
What I did:
What I saw:   (+ screenshot)
What I expected:
```

## Final sign-off

| Phase | All boxes ticked? | Tested by | Date |
|---|---|---|---|
| 0 – Login & Security | | | |
| 1 – Departments / Fixed tasks / Holidays | | | |
| 2 – Seen / Pause / Work time | | | |
| 3 – Urgent | | | |
| 4 – Alert notifications / Reminders | | | |
| 5 – Team Board / Reports | | | |
| Old features | | | |
