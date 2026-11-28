import mongoose from "mongoose";
import Task from "@/models/Task";
import TaskActivity from "@/models/TaskActivity";
import { generateTaskNo } from "./taskNumber";
import { assertDepartmentIds } from "./orgService";
import { notifyNewTask, notifyUrgent } from "@/lib/notify/taskAlerts";
import { istDayBounds } from "./ist";
import {
  TaskActor, TaskError, canAssignTo, canViewTask, getTaskRole, isManagerOrAdmin, usersCollection, visibilityFilter,
} from "./permissions";
import {
  ACTIVE_STATUSES, ALLOWED_TRANSITIONS, DONE_STATUSES, TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, WAITING_ON,
  TaskStatKey, TaskStatus,
} from "./types";

// All lifecycle rules, permission checks and activity logging live here so the
// route files stay thin (spec section 3 / 5).

const CONFLICT_MSG = "Task kisi aur ne update kiya hai, refresh karo";
const LINK_KEYS = ["sellerOrderId", "gemOrderNo", "bidId", "bidNo", "billId", "billNo", "buyerName", "buyerPhone"] as const;

/* ------------------------------------------------------------------ helpers */

const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseDate(v: any, label: string): Date {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) throw new TaskError(400, `${label} sahi date nahi hai`);
  return d;
}

function cleanLinks(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object") {
    for (const k of LINK_KEYS) {
      const v = str(raw[k], 200);
      if (v) out[k] = v;
    }
  }
  return out;
}

export async function existingUsernames(names: string[]): Promise<Set<string>> {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return new Set();
  const found = await usersCollection().find({ username: { $in: unique } }, { projection: { username: 1 } }).toArray();
  const set = new Set<string>(found.map((u: any) => u.username));
  // hardcoded admins may not be stored in the users collection
  for (const n of unique) if (["admin", "chintan", "hitesh"].includes(n.toLowerCase())) set.add(n);
  return set;
}

async function assertUserExists(username: string) {
  if (!(await existingUsernames([username])).has(username)) {
    throw new TaskError(400, `User "${username}" nahi mila`);
  }
}

export async function logActivity(taskId: any, by: string | null, type: string, text = "", from?: any, to?: any) {
  await TaskActivity.create({ taskId: String(taskId), by, type, text, from, to });
}

async function loadTask(actor: TaskActor, id: string) {
  if (!mongoose.isValidObjectId(id)) throw new TaskError(404, "Task nahi mila");
  const task: any = await Task.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
  if (!task) throw new TaskError(404, "Task nahi mila");
  if (!canViewTask(actor, task)) throw new TaskError(403, "Is task ko dekhne ki permission nahi hai");
  return task;
}

/** Update guarded by the loaded updatedAt, so concurrent edits give a 409 instead of overwriting. */
async function applyUpdate(task: any, set: Record<string, any>, unset: string[] = []) {
  const update: any = { $set: set };
  if (unset.length) update.$unset = Object.fromEntries(unset.map((k) => [k, 1]));
  const updated: any = await Task.findOneAndUpdate(
    { _id: task._id, updatedAt: task.updatedAt, isDeleted: { $ne: true } },
    update,
    { new: true }
  ).lean();
  if (!updated) throw new TaskError(409, CONFLICT_MSG);
  return updated;
}

function requireReason(body: any, what: string): string {
  const reason = str(body?.reason, 1000);
  if (!reason) throw new TaskError(400, `${what} ke liye reason likhna zaroori hai`);
  return reason;
}

/* ------------------------------------------------- seen + work sessions */

/** The assignee acting on a task has obviously seen it: fields to merge into the update. */
function seenPatch(actor: TaskActor, task: any, now: Date): Record<string, any> {
  return task.assignee === actor.username && !task.seenAt ? { seenAt: now } : {};
}

const hasOpenSession = (task: any) => {
  const s = task.workSessions || [];
  return s.length > 0 && !s[s.length - 1].end;
};

/** Start/Resume: begin a working period (no-op if one is already running). */
function openSession(task: any, now: Date): Record<string, any> {
  if (hasOpenSession(task)) return {};
  return { workSessions: [...(task.workSessions || []), { start: now }] };
}

/** Pause/Waiting/Done/Cancel: end the running period and add it to totalWorkSeconds. */
function closeSession(task: any, now: Date, reason = ""): Record<string, any> {
  if (!hasOpenSession(task)) return {};
  const sessions = [...task.workSessions];
  const last = { ...sessions[sessions.length - 1], end: now, ...(reason ? { pauseReason: reason.slice(0, 300) } : {}) };
  sessions[sessions.length - 1] = last;
  const secs = Math.max(0, Math.round((now.getTime() - new Date(last.start).getTime()) / 1000));
  return { workSessions: sessions, totalWorkSeconds: (task.totalWorkSeconds || 0) + secs };
}

/* --------------------------------------------------------------- urgent flow */

export interface AutoPaused { taskId: string; taskNo: string; assignee: string }

// An urgent task in one of these states interrupts the assignee's running work.
const URGENT_TRIGGER_STATUSES = ["OPEN", "IN_PROGRESS", "PAUSED"];

/**
 * `urgent` just became URGENT for its assignee (created / priority raised /
 * reassigned / reopened): auto-pause whatever non-urgent task that person has
 * IN_PROGRESS, with reason "Urgent task aaya: <taskNo>". Never throws - an
 * auto-pause problem must not fail the create/update that triggered it.
 */
export async function pauseForUrgent(urgent: any, by: string | null = null): Promise<AutoPaused[]> {
  const paused: AutoPaused[] = [];
  if (urgent?.priority !== "URGENT" || urgent.isDeleted || !URGENT_TRIGGER_STATUSES.includes(urgent.status)) return paused;
  try {
    const running: any[] = await Task.find({
      assignee: urgent.assignee,
      status: "IN_PROGRESS",
      priority: { $ne: "URGENT" }, // one urgent never pauses another urgent
      isDeleted: { $ne: true },
      _id: { $ne: urgent._id },
    }).lean();
    const reason = `Urgent task aaya: ${urgent.taskNo}`;
    const now = new Date();
    for (const t of running) {
      // Same optimistic lock as applyUpdate; if it changed meanwhile, leave it alone.
      const ok = await Task.findOneAndUpdate(
        { _id: t._id, updatedAt: t.updatedAt, status: "IN_PROGRESS", isDeleted: { $ne: true } },
        { $set: { status: "PAUSED", ...closeSession(t, now, reason) } },
        { new: true }
      ).lean();
      if (!ok) continue;
      await logActivity(t._id, null, "PAUSED", `Auto-pause: ${reason}`, "IN_PROGRESS", "PAUSED");
      paused.push({ taskId: String(t._id), taskNo: t.taskNo, assignee: t.assignee });
    }
    if (paused.length) {
      await logActivity(urgent._id, null, "EDITED", `Urgent: ${urgent.assignee} ka chalu kaam pause kiya (${paused.map((p) => p.taskNo).join(", ")})`);
    }
  } catch (e) {
    console.error(`Urgent auto-pause fail (${urgent?.taskNo}):`, e);
  }
  // Instant alert (push) to the assignee (skipped if they made it urgent themselves).
  await notifyUrgent(urgent, by, paused);
  return paused;
}

/* ------------------------------------------------------------------- create */

const MAX_BULK_ASSIGNEES = 100;

/**
 * Who gets the new task: body.departmentId (every member, one task each),
 * body.assignees[] (one task each), or the old single body.assignee (default: me).
 */
async function resolveAssignees(actor: TaskActor, body: any): Promise<string[]> {
  let names: string[];
  if (body.departmentId) {
    const [deptId] = await assertDepartmentIds([str(body.departmentId, 50)], { activeOnly: true });
    const members = await usersCollection().find({ department: deptId }, { projection: { username: 1 } }).toArray();
    names = members.map((m: any) => m.username);
    if (!names.length) throw new TaskError(400, "Is department mein koi user nahi hai");
  } else if (Array.isArray(body.assignees) && body.assignees.length) {
    names = body.assignees.map((a: any) => str(a, 100)).filter(Boolean);
  } else {
    names = [str(body.assignee, 100) || actor.username];
  }
  names = [...new Set(names)];
  if (!names.length) throw new TaskError(400, "Assignee chuno");
  if (names.length > MAX_BULK_ASSIGNEES) throw new TaskError(400, `Ek baar mein max ${MAX_BULK_ASSIGNEES} logon ko task de sakte ho`);

  const blocked = names.find((n) => !canAssignTo(actor, n));
  if (blocked) {
    throw new TaskError(
      403,
      actor.role === "staff" ? "Staff sirf apne naam par task bana sakte hain" : `Aap sirf apni team ko task assign kar sakte ho ("${blocked}")`
    );
  }
  const known = await existingUsernames(names);
  const missing = names.find((n) => !known.has(n));
  if (missing) throw new TaskError(400, `User "${missing}" nahi mila`);
  return names;
}

export async function createTask(actor: TaskActor, body: any) {
  const title = str(body.title, 200);
  if (!title) throw new TaskError(400, "Title zaroori hai");
  if (typeof body.title === "string" && body.title.trim().length > 200) throw new TaskError(400, "Title 200 characters se zyada nahi ho sakta");

  const description = str(body.description, 5000);
  const assignees = await resolveAssignees(actor, body);

  const dueAt = parseDate(body.dueAt, "Due date");
  let warning: string | undefined;
  if (dueAt.getTime() < Date.now() - 60 * 1000) {
    if (actor.role !== "admin") throw new TaskError(400, "Due date past mein nahi ho sakti");
    warning = "Due date past mein hai - task turant overdue dikhega";
  }

  const priority = body.priority ?? "NORMAL";
  if (!TASK_PRIORITIES.includes(priority)) throw new TaskError(400, "Priority sahi nahi hai");
  const category = body.category ?? "GENERAL";
  if (!TASK_CATEGORIES.includes(category)) throw new TaskError(400, "Category sahi nahi hai");

  const watcherNames: string[] = Array.isArray(body.watchers) ? body.watchers.map((w: any) => str(w, 100)) : [];
  const knownWatchers = await existingUsernames(watcherNames);

  const checklist = (Array.isArray(body.checklist) ? body.checklist : [])
    .map((c: any) => str(typeof c === "string" ? c : c?.text, 300))
    .filter(Boolean)
    .slice(0, 50)
    .map((text: string) => ({ text, done: false }));

  // One independent task per assignee (own taskNo, status, checklist).
  const created: any[] = [];
  for (const assignee of assignees) {
    const watchers = [...new Set(watcherNames)].filter((w) => w && w !== assignee && knownWatchers.has(w));
    const task = await Task.create({
      taskNo: await generateTaskNo(),
      title,
      description,
      category,
      priority,
      firm: str(body.firm, 100),
      links: cleanLinks(body.links),
      assignedBy: actor.username,
      assignee,
      watchers,
      dueAt,
      requiresVerification: typeof body.requiresVerification === "boolean" ? body.requiresVerification : true,
      checklist,
      source: "WEB",
      // A task you give yourself is seen by definition.
      ...(assignee === actor.username ? { seenAt: new Date() } : {}),
    });
    await logActivity(
      task._id, actor.username, "CREATED",
      assignee === actor.username ? "Task banaya" : `Task banaya, ${assignee} ko assign kiya`,
      null, { assignee, dueAt, priority, ...(body.departmentId ? { departmentId: String(body.departmentId) } : {}) }
    );
    created.push(task.toObject());
  }
  const autoPaused: AutoPaused[] = [];
  if (priority === "URGENT") for (const t of created) autoPaused.push(...(await pauseForUrgent(t, actor.username)));
  else await Promise.all(created.map((t) => notifyNewTask(t, actor.username)));
  return { task: created[0], tasks: created, count: created.length, autoPaused, ...(warning ? { warning } : {}) };
}

/* --------------------------------------------------------------------- list */

function viewFilter(actor: TaskActor, view: string): Record<string, any> {
  switch (view) {
    case "byme":
      return { assignedBy: actor.username };
    case "watching":
      return { watchers: actor.username };
    case "team":
      if (actor.role === "staff") throw new TaskError(403, "Team view sirf manager/admin ke liye hai");
      return {};
    case "all":
      if (actor.role === "staff") throw new TaskError(403, "All view sirf manager/admin ke liye hai");
      return {};
    default: // "my" - tasks I own; tasks I only watch live under "watching"
      return { assignee: actor.username };
  }
}

function statFilter(key: TaskStatKey, now: Date): Record<string, any> {
  const { start, end } = istDayBounds(now);
  switch (key) {
    case "open": return { status: { $in: ACTIVE_STATUSES } };
    case "dueToday": return { status: { $in: ACTIVE_STATUSES }, dueAt: { $gte: start, $lt: end } };
    case "overdue": return { status: { $in: ACTIVE_STATUSES }, dueAt: { $lt: now } };
    case "waiting": return { status: "WAITING" };
    case "followUpsToday": return { status: { $nin: ["CLOSED", "CANCELLED"] }, nextFollowUpAt: { $lt: end } };
    case "toVerify": return { status: "DONE" };
    case "paused": return { status: "PAUSED" };
    // Only OPEN: once a task moved on, somebody has clearly seen it (also keeps pre-Phase-2 tasks quiet).
    // Self-assigned tasks never count.
    case "notSeen": return { status: "OPEN", seenAt: null, $expr: { $ne: ["$assignee", "$assignedBy"] } };
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function baseFilter(actor: TaskActor, view: string): Record<string, any> {
  const parts: Record<string, any>[] = [{ isDeleted: { $ne: true } }];
  const vis = visibilityFilter(actor);
  if (Object.keys(vis).length) parts.push(vis);
  const vf = viewFilter(actor, view);
  if (Object.keys(vf).length) parts.push(vf);
  return { $and: parts };
}

export async function listTasks(actor: TaskActor, sp: URLSearchParams) {
  const now = new Date();
  const view = sp.get("view") || "my";
  const parts: Record<string, any>[] = [baseFilter(actor, view)];

  const status = sp.get("status");
  if (status) {
    if (!TASK_STATUSES.includes(status as TaskStatus)) throw new TaskError(400, "Status sahi nahi hai");
    parts.push({ status });
  }
  for (const key of ["priority", "firm", "category", "assignee"] as const) {
    const v = sp.get(key);
    if (v) parts.push({ [key]: v });
  }
  const kind = sp.get("kind");
  if (kind === "recurring") parts.push({ source: "RECURRING" });
  else if (kind === "assigned") parts.push({ source: { $ne: "RECURRING" } });
  else if (kind) throw new TaskError(400, "Kind sahi nahi hai");
  if (sp.get("overdue") === "true") parts.push(statFilter("overdue", now));
  const stat = sp.get("stat") as TaskStatKey | null;
  if (stat) {
    const f = statFilter(stat, now);
    if (!f) throw new TaskError(400, "Stat sahi nahi hai");
    parts.push(f);
  }
  const q = (sp.get("q") || "").trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    parts.push({ $or: [{ taskNo: rx }, { title: rx }, { description: rx }, { assignee: rx }, { "links.buyerName": rx }, { "links.gemOrderNo": rx }] });
  }

  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10) || 50));
  const match = { $and: parts };

  // Active URGENT tasks always come first, whatever the sort.
  const sortStage: Record<string, 1 | -1> =
    sp.get("sort") === "newest" ? { _urg: 1, createdAt: -1, _id: -1 } : { _urg: 1, _rank: 1, dueAt: 1, _id: 1 };

  const [tasks, total] = await Promise.all([
    Task.aggregate([
      { $match: match },
      {
        $addFields: {
          _rank: {
            $switch: {
              branches: [
                { case: { $and: [{ $in: ["$status", ACTIVE_STATUSES] }, { $lt: ["$dueAt", now] }] }, then: 0 },
                { case: { $in: ["$status", ACTIVE_STATUSES] }, then: 1 },
                { case: { $eq: ["$status", "DONE"] }, then: 2 },
              ],
              default: 3,
            },
          },
          _urg: {
            $cond: [{ $and: [{ $eq: ["$priority", "URGENT"] }, { $in: ["$status", ACTIVE_STATUSES] }] }, 0, 1],
          },
        },
      },
      { $sort: sortStage },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { _rank: 0, _urg: 0 } },
    ]),
    Task.countDocuments(match),
  ]);

  return { tasks, total, page, limit };
}

export async function taskSummary(actor: TaskActor, view: string) {
  const now = new Date();
  const base = baseFilter(actor, view);
  const keys: TaskStatKey[] = ["open", "dueToday", "overdue", "waiting", "followUpsToday", "toVerify", "paused", "notSeen"];
  const counts = await Promise.all(keys.map((k) => Task.countDocuments({ $and: [base, statFilter(k, now)] })));
  return Object.fromEntries(keys.map((k, i) => [k, counts[i]]));
}

/** Navbar badge: tasks assigned to the acting user that are not done (uses the assignee+status index). */
export async function pendingTaskCount(actor: TaskActor) {
  const count = await Task.countDocuments({
    assignee: actor.username,
    status: { $nin: DONE_STATUSES },
    isDeleted: { $ne: true },
  });
  return { count };
}

/* ------------------------------------------------------------------- detail */

export async function getTaskDetail(actor: TaskActor, id: string) {
  const task = await loadTask(actor, id);
  const activities = await TaskActivity.find({ taskId: String(task._id) }).sort({ createdAt: -1 }).limit(200).lean();
  return { task, activities };
}

/* --------------------------------------------------------------------- seen */

/**
 * POST /api/tasks/[id]/seen - assignee opened the drawer / tapped "Dekh liya".
 * Sets seenAt once (+ SEEN activity). Anyone else, or a second call, is a no-op.
 * Does not bump updatedAt, so it never causes a 409 for someone editing.
 */
export async function markSeen(actor: TaskActor, id: string) {
  const task = await loadTask(actor, id);
  if (task.assignee !== actor.username || task.seenAt) return { task, seen: false };
  const updated: any = await Task.findOneAndUpdate(
    { _id: task._id, seenAt: null },
    { $set: { seenAt: new Date() } },
    { new: true, timestamps: false }
  ).lean();
  if (!updated) return { task: await Task.findById(task._id).lean(), seen: false }; // a parallel call won
  await logActivity(task._id, actor.username, "SEEN", "Task dekh liya");
  return { task: updated, seen: true };
}

/* -------------------------------------------------------------------- patch */

export async function patchTask(actor: TaskActor, id: string, body: any) {
  const task = await loadTask(actor, id);

  if (body.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== new Date(task.updatedAt).getTime()) {
    throw new TaskError(409, CONFLICT_MSG);
  }
  if (task.status === "CLOSED" || task.status === "CANCELLED") {
    throw new TaskError(400, "Closed/Cancelled task edit nahi ho sakta (pehle Reopen karo)");
  }

  const mgr = isManagerOrAdmin(actor);
  const FIELDS = ["title", "description", "priority", "dueAt", "firm", "category", "links", "watchers", "checklist"];
  const touched = FIELDS.filter((f) => body[f] !== undefined);
  if (!mgr) {
    if (task.assignee !== actor.username) throw new TaskError(403, "Sirf apne task ka checklist update kar sakte ho");
    if (touched.some((f) => f !== "checklist")) throw new TaskError(403, "Staff sirf checklist tick kar sakta hai");
  }

  const set: Record<string, any> = {};
  const acts: { type: string; text: string; from?: any; to?: any }[] = [];
  const editedFields: string[] = [];

  if (body.title !== undefined) {
    const title = str(body.title, 200);
    if (!title) throw new TaskError(400, "Title khali nahi ho sakta");
    if (title !== task.title) { set.title = title; editedFields.push("title"); }
  }
  if (body.description !== undefined) {
    const d = str(body.description, 5000);
    if (d !== task.description) { set.description = d; editedFields.push("description"); }
  }
  if (body.firm !== undefined) {
    const f = str(body.firm, 100);
    if (f !== task.firm) { set.firm = f; editedFields.push("firm"); }
  }
  if (body.category !== undefined) {
    if (!TASK_CATEGORIES.includes(body.category)) throw new TaskError(400, "Category sahi nahi hai");
    if (body.category !== task.category) { set.category = body.category; editedFields.push("category"); }
  }
  if (body.links !== undefined) {
    set.links = cleanLinks(body.links);
    editedFields.push("links");
  }
  if (body.watchers !== undefined) {
    const names: string[] = (Array.isArray(body.watchers) ? body.watchers : []).map((w: any) => str(w, 100));
    const known = await existingUsernames(names);
    const watchers = [...new Set(names)].filter((w) => w && w !== task.assignee && known.has(w));
    if (watchers.join("|") !== (task.watchers || []).join("|")) { set.watchers = watchers; editedFields.push("watchers"); }
  }
  if (body.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(body.priority)) throw new TaskError(400, "Priority sahi nahi hai");
    if (body.priority !== task.priority) {
      set.priority = body.priority;
      acts.push({ type: "PRIORITY_CHANGED", text: `Priority ${task.priority} → ${body.priority}`, from: task.priority, to: body.priority });
    }
  }
  if (body.dueAt !== undefined) {
    const dueAt = parseDate(body.dueAt, "Due date");
    if (dueAt.getTime() !== new Date(task.dueAt).getTime()) {
      if (dueAt.getTime() < Date.now() - 60 * 1000 && actor.role !== "admin") {
        throw new TaskError(400, "Due date past mein nahi ho sakti");
      }
      set.dueAt = dueAt;
      acts.push({ type: "DUE_CHANGED", text: "Due date badli", from: task.dueAt, to: dueAt });
    }
  }
  if (body.checklist !== undefined) {
    if (!Array.isArray(body.checklist)) throw new TaskError(400, "Checklist sahi format mein nahi hai");
    const existing: any[] = task.checklist || [];
    const byId = new Map(existing.map((c) => [String(c._id), c]));
    const now = new Date();
    let next: any[];

    if (mgr) {
      next = body.checklist.slice(0, 50).map((c: any) => {
        const text = str(c?.text, 300);
        if (!text) throw new TaskError(400, "Checklist item khali nahi ho sakta");
        const old = c?._id ? byId.get(String(c._id)) : null;
        const done = !!c?.done;
        if (old) {
          const changed = old.done !== done;
          return { _id: old._id, text, done, doneBy: changed ? (done ? actor.username : undefined) : old.doneBy, doneAt: changed ? (done ? now : undefined) : old.doneAt };
        }
        return { text, done, doneBy: done ? actor.username : undefined, doneAt: done ? now : undefined };
      });
    } else {
      // staff: only flip `done` on items that already exist
      const wanted = new Map<string, boolean>(body.checklist.filter((c: any) => c?._id).map((c: any) => [String(c._id), !!c.done]));
      next = existing.map((old) => {
        const done = wanted.has(String(old._id)) ? wanted.get(String(old._id))! : old.done;
        if (done === old.done) return old;
        return { ...old, done, doneBy: done ? actor.username : undefined, doneAt: done ? now : undefined };
      });
    }

    const sig = (list: any[]) => list.map((c) => `${c._id || ""}:${c.text}:${c.done ? 1 : 0}`).join("|");
    if (sig(next) !== sig(existing)) {
      set.checklist = next;
      const doneNow = next.filter((c) => c.done).length;
      acts.push({ type: "CHECKLIST", text: `Checklist update: ${doneNow}/${next.length} done` });
    }
  }

  if (editedFields.length) acts.unshift({ type: "EDITED", text: `Edited: ${editedFields.join(", ")}` });
  if (!Object.keys(set).length) return { task };

  const seen = seenPatch(actor, task, new Date());
  if (seen.seenAt) { Object.assign(set, seen); acts.unshift({ type: "SEEN", text: "Task dekh liya" }); }

  const updated = await applyUpdate(task, set);
  for (const a of acts) await logActivity(task._id, actor.username, a.type, a.text, a.from, a.to);
  const autoPaused = set.priority === "URGENT" ? await pauseForUrgent(updated, actor.username) : [];
  return { task: updated, autoPaused };
}

/* ------------------------------------------------------------------- status */

export async function changeStatus(actor: TaskActor, id: string, body: any) {
  const task = await loadTask(actor, id);
  const to = body.status as TaskStatus;
  if (!TASK_STATUSES.includes(to)) throw new TaskError(400, "Status sahi nahi hai");
  const from = task.status as TaskStatus;

  if (from === to) throw new TaskError(400, "Task pehle se isi status mein hai");
  if (from === "DONE") throw new TaskError(400, "Done task ko Verify ya Reject karo");
  if (from === "CLOSED") throw new TaskError(400, "Closed task ko Reopen karo");
  if (to === "CLOSED") throw new TaskError(400, "Close karne ke liye Verify use karo");
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new TaskError(400, `${from} se ${to} allowed nahi hai`);

  const mgr = isManagerOrAdmin(actor);
  if (!mgr && task.assignee !== actor.username) throw new TaskError(403, "Staff sirf apne task ka status badal sakta hai");
  if (to === "CANCELLED" && !mgr) throw new TaskError(403, "Task cancel sirf manager/admin kar sakte hain");

  const now = new Date();
  const set: Record<string, any> = { status: to };
  const unset: string[] = [];
  const acts: { type: string; text: string; from?: any; to?: any }[] = [];
  let reason = "";

  // Assignee changing status = seen.
  const seen = seenPatch(actor, task, now);
  if (seen.seenAt) { Object.assign(set, seen); acts.push({ type: "SEEN", text: "Task dekh liya" }); }

  if (to === "CANCELLED") {
    reason = requireReason(body, "Cancel");
    acts.push({ type: "CANCELLED", text: `Cancelled: ${reason}`, from, to });
    set.waitingOn = null;
    Object.assign(set, closeSession(task, now, "Cancelled"));
  } else if (to === "PAUSED") {
    reason = requireReason(body, "Pause");
    Object.assign(set, closeSession(task, now, reason));
    acts.push({ type: "PAUSED", text: `Pause: ${reason}`, from, to });
  } else if (to === "WAITING") {
    if (!WAITING_ON.includes(body.waitingOn)) throw new TaskError(400, "Waiting ke liye 'kiska wait' (waitingOn) chuno");
    if (!body.nextFollowUpAt) throw new TaskError(400, "Waiting ke liye next follow-up date zaroori hai");
    set.waitingOn = body.waitingOn;
    set.nextFollowUpAt = parseDate(body.nextFollowUpAt, "Next follow-up");
    Object.assign(set, closeSession(task, now, `Waiting: ${body.waitingOn}`));
    acts.push({ type: "STATUS_CHANGED", text: `Waiting on ${body.waitingOn}`, from, to });
  } else if (to === "IN_PROGRESS") {
    set.waitingOn = null;
    if (!task.startedAt) set.startedAt = now;
    Object.assign(set, openSession(task, now));
    if (from === "PAUSED") acts.push({ type: "RESUMED", text: "Resume kiya (kaam dobara shuru)", from, to });
    else acts.push({ type: "STATUS_CHANGED", text: from === "WAITING" ? "Kaam dobara shuru" : "Kaam shuru", from, to });
  } else if (to === "DONE") {
    set.waitingOn = null;
    set.completedAt = now;
    Object.assign(set, closeSession(task, now));
    acts.push({ type: "STATUS_CHANGED", text: "Done mark kiya", from, to });
    if (!task.requiresVerification) {
      set.status = "CLOSED";
      set.closedAt = now;
      set.closedBy = actor.username;
      acts.push({ type: "VERIFIED", text: "Auto-closed (verification zaroori nahi)", from: "DONE", to: "CLOSED" });
    }
  }

  const updated = await applyUpdate(task, set, unset);
  for (const a of acts) await logActivity(task._id, actor.username, a.type, a.text, a.from, a.to);
  return { task: updated };
}

/* ------------------------------------------------------------------- assign */

export async function assignTask(actor: TaskActor, id: string, body: any) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Reassign sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status === "CLOSED" || task.status === "CANCELLED") throw new TaskError(400, "Closed/Cancelled task reassign nahi hota");

  const assignee = str(body.assignee, 100);
  if (!assignee) throw new TaskError(400, "Assignee chuno");
  if (assignee === task.assignee) throw new TaskError(400, "Task pehle se isi ke paas hai");
  if (!canAssignTo(actor, assignee)) throw new TaskError(403, "Aap sirf apni team ko task assign kar sakte ho");
  await assertUserExists(assignee);

  // Old assignee stays in the loop as a watcher; new one is removed from watchers.
  const watchers = [...new Set([...(task.watchers || []), task.assignee])].filter((w) => w !== assignee);
  const note = str(body.note, 500);
  const updated = await applyUpdate(task, { assignee, watchers });
  await logActivity(task._id, actor.username, "REASSIGNED", `${task.assignee} → ${assignee}${note ? `: ${note}` : ""}`, task.assignee, assignee);
  if (updated.priority !== "URGENT") await notifyNewTask(updated, actor.username);
  return { task: updated, autoPaused: await pauseForUrgent(updated, actor.username) };
}

/* ----------------------------------------------------- verify/reject/reopen */

export async function verifyTask(actor: TaskActor, id: string) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Verify sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status !== "DONE") throw new TaskError(400, "Sirf Done task verify ho sakta hai");
  const now = new Date();
  const updated = await applyUpdate(task, { status: "CLOSED", closedAt: now, closedBy: actor.username });
  await logActivity(task._id, actor.username, "VERIFIED", "Verify karke close kiya", "DONE", "CLOSED");
  return { task: updated };
}

export async function rejectTask(actor: TaskActor, id: string, body: any) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Reject sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status !== "DONE") throw new TaskError(400, "Sirf Done task reject ho sakta hai");
  const reason = requireReason(body, "Reject");
  // Back to IN_PROGRESS = the rework clock starts again.
  const updated = await applyUpdate(task, { status: "IN_PROGRESS", ...openSession(task, new Date()) }, ["completedAt"]);
  await logActivity(task._id, actor.username, "REJECTED", `Rejected: ${reason}`, "DONE", "IN_PROGRESS");
  return { task: updated };
}

export async function reopenTask(actor: TaskActor, id: string, body: any) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Reopen sirf manager/admin kar sakte hain");
  const task = await loadTask(actor, id);
  if (task.status !== "CLOSED") throw new TaskError(400, "Sirf Closed task reopen ho sakta hai");
  const reason = requireReason(body, "Reopen");
  const updated = await applyUpdate(task, { status: "OPEN" }, ["completedAt", "closedAt", "closedBy"]);
  await logActivity(task._id, actor.username, "REOPENED", `Reopened: ${reason}`, "CLOSED", "OPEN");
  return { task: updated, autoPaused: await pauseForUrgent(updated, actor.username) };
}

/* ----------------------------------------------------------------- comments */

export async function addComment(actor: TaskActor, id: string, body: any) {
  const task = await loadTask(actor, id);
  const text = str(body.text, 2000);
  if (!text) throw new TaskError(400, "Comment khali nahi ho sakta");

  const handles = [...text.matchAll(/@([A-Za-z0-9_.-]+)/g)].map((m) => m[1]);
  const mentions = handles.length ? [...(await existingUsernames(handles))] : [];

  const activity = await TaskActivity.create({ taskId: String(task._id), by: actor.username, type: "COMMENT", text, to: mentions });
  return { activity: activity.toObject() };
}

/* ------------------------------------------------------------------- delete */

export async function softDeleteTask(actor: TaskActor, id: string) {
  if (actor.role !== "admin") throw new TaskError(403, "Task delete sirf admin kar sakta hai");
  const task = await loadTask(actor, id);
  await applyUpdate(task, { isDeleted: true });
  await logActivity(task._id, actor.username, "DELETED", "Task delete kiya");
  return { success: true };
}

/* -------------------------------------------------------------------- users */

export async function listTaskUsers(actor: TaskActor) {
  const [users, counts] = await Promise.all([
    usersCollection().find({}, { projection: { username: 1, permissions: 1, managerUsername: 1, department: 1 } }).toArray(),
    Task.aggregate([
      { $match: { isDeleted: { $ne: true }, status: { $in: ACTIVE_STATUSES } } },
      { $group: { _id: "$assignee", n: { $sum: 1 } } },
    ]),
  ]);
  const open = new Map<string, number>(counts.map((c: any) => [c._id, c.n]));

  const rows = users.map((u: any) => ({
    username: u.username as string,
    role: ["admin", "chintan", "hitesh"].includes(String(u.username).toLowerCase()) ? ("admin" as const) : getTaskRole(u),
    managerUsername: (u.managerUsername as string) || null,
    department: typeof u.department === "string" && u.department ? (u.department as string) : null,
  }));
  for (const name of ["admin", "chintan", "hitesh"]) {
    if (!rows.some((r) => r.username.toLowerCase() === name)) rows.push({ username: name, role: "admin", managerUsername: null, department: null });
  }

  return rows
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((r) => ({ ...r, openCount: open.get(r.username) || 0, assignable: canAssignTo(actor, r.username) }));
}
