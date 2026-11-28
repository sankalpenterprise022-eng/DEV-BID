import Task from "@/models/Task";
import ReminderLog from "@/models/ReminderLog";
import PushSubscription from "@/models/PushSubscription";
import { usersCollection } from "@/lib/tasks/permissions";
import { notifyMany } from "./index";
import { getTaskSettings, isWorkTime } from "./workHours";

// Task-level alerts shared by the API (instant) and the cron tick (reminders).
// Every alert first "claims" a unique reminder_log key, so nothing is sent twice.

let indexesReady: Promise<unknown> | null = null;
/** Explicit createIndex: the unique key must exist before the first claim (autoIndex is async). */
export function ensureNotifyIndexes() {
  indexesReady ??= Promise.all([
    ReminderLog.collection.createIndex({ key: 1 }, { unique: true }),
    ReminderLog.collection.createIndex({ sentAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }),
    PushSubscription.collection.createIndex({ endpoint: 1 }, { unique: true }),
    PushSubscription.collection.createIndex({ username: 1 }),
  ]).catch((e) => { indexesReady = null; throw e; });
  return indexesReady;
}

/** true = this caller owns the reminder and must send it; false = already sent. */
export async function claimReminder(key: string, meta: { kind: string; taskId?: any; to?: string[] }) {
  await ensureNotifyIndexes();
  try {
    await ReminderLog.create({ key, kind: meta.kind, taskId: meta.taskId ? String(meta.taskId) : null, to: meta.to || [] });
    return true;
  } catch (e: any) {
    if (e?.code === 11000) return false;
    throw e;
  }
}

/** Stamp lastReminderAt without touching updatedAt (keeps optimistic locking quiet for users). */
export async function markReminded(taskId: any, extra: Record<string, any> = {}) {
  const { $inc, ...set } = extra;
  await Task.updateOne(
    { _id: taskId },
    { $set: { lastReminderAt: new Date(), ...set }, ...($inc ? { $inc } : {}) },
    { timestamps: false }
  );
}

export const taskUrl = (t: any) => `/dashboard/tasks?task=${t._id}`;

const dueText = (d: any) =>
  new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export { dueText };

/** The assignee's task manager (users.managerUsername), if any. */
export async function managerOf(username: string): Promise<string | null> {
  const u: any = await usersCollection().findOne({ username }, { projection: { managerUsername: 1 } });
  return u?.managerUsername || null;
}

/**
 * New task for someone else: push the assignee now. Non-urgent tasks created
 * outside work hours are left unclaimed - the cron tick sends them when work starts.
 */
export async function notifyNewTask(task: any, by: string | null) {
  try {
    if (!task || task.assignee === by || task.assignee === task.assignedBy) return;
    if (task.priority === "URGENT") return notifyUrgent(task, by, []);
    if (!(await isWorkTime(await getTaskSettings()))) return;
    if (!(await claimReminder(`new:${task._id}:${task.assignee}`, { kind: "NEW", taskId: task._id, to: [task.assignee] }))) return;
    await notifyMany([task.assignee], {
      title: `🆕 Naya task: ${task.title}`,
      body: `${task.taskNo} · ${task.assignedBy} ne diya · Due ${dueText(task.dueAt)}`,
      url: taskUrl(task),
      tag: `task-${task._id}`,
    });
    await markReminded(task._id);
  } catch (e) {
    console.error(`New-task alert fail (${task?.taskNo}):`, e);
  }
}

/** Task became URGENT for its assignee: instant push alert (ignores work hours). */
export async function notifyUrgent(task: any, by: string | null, autoPaused: { taskNo: string }[]) {
  try {
    if (!task || task.assignee === by) return;
    if (!(await claimReminder(`urgent:${task._id}:${task.assignee}`, { kind: "URGENT", taskId: task._id, to: [task.assignee] }))) return;
    // New URGENT tasks also count as "new task" alerts, so the cron does not repeat them.
    await claimReminder(`new:${task._id}:${task.assignee}`, { kind: "NEW", taskId: task._id, to: [task.assignee] }).catch(() => false);
    const paused = autoPaused.length ? ` · Chalu kaam pause: ${autoPaused.map((p) => p.taskNo).join(", ")}` : "";
    await notifyMany([task.assignee], {
      title: `🚨 URGENT: ${task.title}`,
      body: `${task.taskNo} · ${task.assignedBy} ne diya · Due ${dueText(task.dueAt)}${paused}. Baaki kaam rok kar ye pehle karo.`,
      url: taskUrl(task),
      tag: `task-${task._id}`,
      urgent: true,
    });
    await markReminded(task._id);
  } catch (e) {
    console.error(`Urgent alert fail (${task?.taskNo}):`, e);
  }
}
