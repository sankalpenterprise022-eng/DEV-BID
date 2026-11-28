import dbConnect from "@/lib/dbConnect";
import Task from "@/models/Task";
import PushSubscription from "@/models/PushSubscription";
import { generateRecurringTasks } from "@/lib/tasks/templateService";
import { logActivity } from "@/lib/tasks/taskService";
import { istDateKey, istDateTime, istDayBounds } from "@/lib/tasks/ist";
import { isHardcodedAdmin } from "@/lib/auth/session";
import { usersCollection } from "@/lib/tasks/permissions";
import { notify, notifyMany } from "./index";
import { claimReminder, dueText, managerOf, markReminded, taskUrl } from "./taskAlerts";
import { getTaskSettings, isWorkTime, isWorkingDayNow, istMinutes } from "./workHours";

// The 5-minute cron tick (POST /api/cron/tick). Every step is idempotent via
// reminder_log keys, so running it twice (or two servers at once) sends nothing twice.
// Non-urgent reminders only inside TaskSettings work hours; URGENT always.

const MIN = 60 * 1000;
const PENDING = ["OPEN", "IN_PROGRESS", "PAUSED"]; // can still be worked on (WAITING has its own follow-up)
const ACTIVE = ["OPEN", "IN_PROGRESS", "PAUSED", "WAITING"];
const BATCH = 300;
const RECURRING_AT = 5; // 00:05 IST
const SUMMARY_AT = 19 * 60; // 19:00 IST

export interface TickResult {
  at: string;
  workTime: boolean;
  recurring: any;
  newTask: number;
  notSeen: number;
  dueSoon: number;
  overdue: number;
  escalated: number;
  followUp: number;
  summary: number | null;
  errors: string[];
}

export async function runTick(now: Date = new Date()): Promise<TickResult> {
  await dbConnect();
  const settings = await getTaskSettings();
  const work = await isWorkTime(settings, now);
  const today = istDateKey(now);
  const mins = istMinutes(now);
  const r: TickResult = {
    at: now.toISOString(), workTime: work, recurring: null, newTask: 0, notSeen: 0, dueSoon: 0, overdue: 0, escalated: 0, followUp: 0, summary: null, errors: [],
  };
  // A sender may send only when inside work hours, or for URGENT tasks.
  const allowed = (t: any) => work || t.priority === "URGENT";
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { console.error(`Cron ${name} fail:`, e); r.errors.push(`${name}: ${e?.message || e}`); }
  };

  // 1) 00:05 IST - today's fixed (recurring) tasks.
  await step("recurring", async () => {
    if (mins >= RECURRING_AT && (await claimReminder(`recurring:${today}`, { kind: "RECURRING" }))) {
      r.recurring = await generateRecurringTasks(today);
    }
  });

  // 2) New task -> assignee (covers cron-made fixed tasks and tasks created after hours).
  await step("newTask", async () => {
    const list: any[] = await Task.find({
      isDeleted: { $ne: true }, status: { $in: ACTIVE }, createdAt: { $gte: new Date(now.getTime() - 24 * 60 * MIN) },
      $expr: { $ne: ["$assignee", "$assignedBy"] },
    }).limit(BATCH).lean();
    for (const t of list) {
      if (!allowed(t)) continue;
      if (!(await claimReminder(`new:${t._id}:${t.assignee}`, { kind: "NEW", taskId: t._id, to: [t.assignee] }))) continue;
      await notify(t.assignee, {
        title: `${t.priority === "URGENT" ? "🚨" : "🆕"} Naya task: ${t.title}`,
        body: `${t.taskNo} · ${t.assignedBy} ne diya · Due ${dueText(t.dueAt)}`,
        url: taskUrl(t), tag: `task-${t._id}`, urgent: t.priority === "URGENT",
      });
      await markReminded(t._id);
      r.newTask++;
    }
  });

  // 3) Not seen 30 min after it was given (counted from work start for tasks made before office hours).
  await step("notSeen", async () => {
    const workStart = istDateTime(today, `${String(settings.workStartHour).padStart(2, "0")}:00`).getTime();
    const list: any[] = await Task.find({
      isDeleted: { $ne: true }, status: "OPEN", seenAt: null,
      createdAt: { $lte: new Date(now.getTime() - 30 * MIN), $gte: new Date(now.getTime() - 3 * 24 * 60 * MIN) },
      $expr: { $ne: ["$assignee", "$assignedBy"] },
    }).limit(BATCH).lean();
    for (const t of list) {
      if (!allowed(t)) continue;
      const from = t.priority === "URGENT" ? new Date(t.createdAt).getTime() : Math.max(new Date(t.createdAt).getTime(), workStart);
      if (now.getTime() - from < 30 * MIN) continue;
      const boss = [t.assignedBy, await managerOf(t.assignee)].filter((u) => u && u !== t.assignee) as string[];
      if (!(await claimReminder(`notseen:${t._id}`, { kind: "NOT_SEEN", taskId: t._id, to: [t.assignee, ...boss] }))) continue;
      await notify(t.assignee, {
        title: `👀 Task abhi tak dekha nahi: ${t.title}`,
        body: `${t.taskNo} · ${t.assignedBy} ne diya · Kholo aur "Dekh liya" karo`,
        url: taskUrl(t), tag: `task-${t._id}`, urgent: t.priority === "URGENT",
      });
      await notifyMany(boss, {
        title: `👀 ${t.assignee} ne task nahi dekha`,
        body: `${t.taskNo} · ${t.title} · 30 min se zyada ho gaye`,
        url: taskUrl(t), tag: `notseen-${t._id}`,
      });
      await markReminded(t._id);
      r.notSeen++;
    }
  });

  // 4) Due in the next 30 minutes -> assignee (once per due time; a new due date reminds again).
  await step("dueSoon", async () => {
    const list: any[] = await Task.find({
      isDeleted: { $ne: true }, status: { $in: PENDING }, dueAt: { $gt: now, $lte: new Date(now.getTime() + 30 * MIN) },
    }).limit(BATCH).lean();
    for (const t of list) {
      if (!allowed(t)) continue;
      if (!(await claimReminder(`due30:${t._id}:${new Date(t.dueAt).getTime()}`, { kind: "DUE_SOON", taskId: t._id, to: [t.assignee] }))) continue;
      const left = Math.max(1, Math.round((new Date(t.dueAt).getTime() - now.getTime()) / MIN));
      await notify(t.assignee, {
        title: `⏰ ${left} min mein due: ${t.title}`,
        body: `${t.taskNo} · Due ${dueText(t.dueAt)}`,
        url: taskUrl(t), tag: `task-${t._id}`, urgent: t.priority === "URGENT",
      });
      await markReminded(t._id);
      r.dueSoon++;
    }
  });

  // 5) Overdue -> assignee once a day; assigner + manager once per due date, escalationLevel++.
  await step("overdue", async () => {
    const list: any[] = await Task.find({
      isDeleted: { $ne: true }, status: { $in: ACTIVE }, dueAt: { $lt: now, $gte: new Date(now.getTime() - 60 * 24 * 60 * MIN) },
    }).limit(BATCH).lean();
    for (const t of list) {
      if (!allowed(t)) continue;
      const late = dueText(t.dueAt);
      if (await claimReminder(`overdue:${t._id}:${today}`, { kind: "OVERDUE", taskId: t._id, to: [t.assignee] })) {
        await notify(t.assignee, {
          title: `🔴 Overdue: ${t.title}`,
          body: `${t.taskNo} · Due tha ${late} · Jaldi khatam karo ya update do`,
          url: taskUrl(t), tag: `task-${t._id}`, urgent: t.priority === "URGENT",
        });
        await markReminded(t._id);
        r.overdue++;
      }
      const boss = [t.assignedBy, await managerOf(t.assignee)].filter((u) => u && u !== t.assignee) as string[];
      if (!boss.length) continue;
      if (!(await claimReminder(`escalate:${t._id}:${new Date(t.dueAt).getTime()}`, { kind: "ESCALATE", taskId: t._id, to: boss }))) continue;
      await notifyMany(boss, {
        title: `⚠️ Overdue: ${t.assignee} ka task`,
        body: `${t.taskNo} · ${t.title} · Due tha ${late} · Status ${t.status}`,
        url: taskUrl(t), tag: `escalate-${t._id}`, urgent: t.priority === "URGENT",
      });
      await markReminded(t._id, { $inc: { escalationLevel: 1 } });
      await logActivity(t._id, null, "ESCALATED", `Overdue alert bheja: ${boss.join(", ")} (level ${(t.escalationLevel || 0) + 1})`, t.escalationLevel || 0, (t.escalationLevel || 0) + 1);
      r.escalated++;
    }
  });

  // 6) WAITING and the follow-up time has come -> assignee.
  await step("followUp", async () => {
    const list: any[] = await Task.find({
      isDeleted: { $ne: true }, status: "WAITING", nextFollowUpAt: { $lte: now, $gte: new Date(now.getTime() - 7 * 24 * 60 * MIN) },
    }).limit(BATCH).lean();
    for (const t of list) {
      if (!allowed(t)) continue;
      if (!(await claimReminder(`followup:${t._id}:${new Date(t.nextFollowUpAt).getTime()}`, { kind: "FOLLOWUP", taskId: t._id, to: [t.assignee] }))) continue;
      await notify(t.assignee, {
        title: `📞 Follow-up ka time: ${t.title}`,
        body: `${t.taskNo} · Waiting on ${t.waitingOn || "-"} · Follow-up karo aur status update karo`,
        url: taskUrl(t), tag: `task-${t._id}`,
      });
      await markReminded(t._id);
      r.followUp++;
    }
  });

  // 7) 19:00 IST daily summary -> admins, working days only.
  await step("summary", async () => {
    if (mins < SUMMARY_AT || !(await isWorkingDayNow(settings, now))) return;
    if (!(await claimReminder(`summary:${today}`, { kind: "SUMMARY" }))) return;
    const admins = await adminUsernames();
    const text = await summaryText(now);
    await notifyMany(admins, { title: `📊 Aaj ka summary (${today})`, body: text, url: "/dashboard/tasks?view=all", tag: `summary-${today}` });
    r.summary = admins.length;
  });

  return r;
}

/** DB admins (permissions.boss) + hardcoded admins that have a push subscription. */
async function adminUsernames(): Promise<string[]> {
  const db: any[] = await usersCollection().find({ "permissions.boss": true }, { projection: { username: 1 } }).toArray();
  const subs: string[] = await PushSubscription.distinct("username");
  return [...new Set([...db.map((u) => u.username), ...subs.filter((u) => isHardcodedAdmin(u))])];
}

async function summaryText(now: Date): Promise<string> {
  const { start, end } = istDayBounds(now);
  const live = { isDeleted: { $ne: true } };
  const [created, done, overdue, notSeen, waiting, paused, urgent] = await Promise.all([
    Task.countDocuments({ ...live, createdAt: { $gte: start, $lt: end } }),
    Task.countDocuments({ ...live, completedAt: { $gte: start, $lt: end } }),
    Task.countDocuments({ ...live, status: { $in: ACTIVE }, dueAt: { $lt: now } }),
    Task.countDocuments({ ...live, status: "OPEN", seenAt: null, $expr: { $ne: ["$assignee", "$assignedBy"] } }),
    Task.countDocuments({ ...live, status: "WAITING" }),
    Task.countDocuments({ ...live, status: "PAUSED" }),
    Task.countDocuments({ ...live, status: { $in: ACTIVE }, priority: "URGENT" }),
  ]);
  return [
    `Aaj bane: ${created} · Aaj done: ${done}`,
    `Overdue: ${overdue} · Urgent pending: ${urgent}`,
    `Not seen: ${notSeen} · Waiting: ${waiting} · Paused: ${paused}`,
  ].join("\n");
}
