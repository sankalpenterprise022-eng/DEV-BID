import Task from "@/models/Task";
import TaskActivity from "@/models/TaskActivity";
import Department from "@/models/Department";
import { istDateKey, istDateTime, istDayBounds } from "./ist";
import { TaskActor, TaskError, managerSeesAll, usersCollection } from "./permissions";
import {
  ACTIVE_STATUSES, BoardMemberDTO, BoardTaskDTO, MonthlyReportDTO, ReportRowDTO, TeamBoardDTO,
} from "./types";

// Team board (manager + admin) and monthly report (admin). Read-only: nothing here
// changes tasks, so no activity logging / locking is involved.

const MAX_TASKS = 20_000;

/** Seconds of a work session that fall inside [from, to); a running session counts up to `now`. */
function overlapSeconds(s: { start: any; end?: any }, from: Date, to: Date, now: Date): number {
  const a = Math.max(new Date(s.start).getTime(), from.getTime());
  const b = Math.min(s.end ? new Date(s.end).getTime() : now.getTime(), to.getTime());
  return b > a ? Math.round((b - a) / 1000) : 0;
}

const sessionsTouching = (from: Date, to: Date) => ({
  workSessions: { $elemMatch: { start: { $lt: to }, $or: [{ end: { $gte: from } }, { end: null }] } },
});

/** People this actor may see on the board / report. null = everybody. */
function scope(actor: TaskActor): string[] | null {
  if (actor.role === "admin" || managerSeesAll(actor)) return null;
  if (actor.role === "manager") return [actor.username, ...actor.team];
  throw new TaskError(403, "Team board sirf manager/admin ke liye hai");
}

async function deptNames(): Promise<Map<string, string>> {
  const list: any[] = await Department.find({}, { name: 1 }).lean();
  return new Map(list.map((d) => [String(d._id), d.name]));
}

/* --------------------------------------------------------------- team board */

function boardTask(t: any): BoardTaskDTO {
  const sessions = t.workSessions || [];
  const last = sessions[sessions.length - 1];
  const running = t.status === "IN_PROGRESS" && last && !last.end;
  return {
    _id: String(t._id),
    taskNo: t.taskNo,
    title: t.title,
    priority: t.priority,
    status: t.status,
    dueAt: new Date(t.dueAt).toISOString(),
    ...(running ? { sessionStart: new Date(last.start).toISOString() } : {}),
    totalWorkSeconds: t.totalWorkSeconds || 0,
    ...(t.status === "PAUSED" && last?.pauseReason ? { pauseReason: last.pauseReason } : {}),
  };
}

const byUrgencyThenDue = (a: any, b: any) =>
  (a.priority === "URGENT" ? 0 : 1) - (b.priority === "URGENT" ? 0 : 1) || new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();

/** GET /api/team-board - who is working on what right now. */
export async function teamBoard(actor: TaskActor): Promise<TeamBoardDTO> {
  const people = scope(actor);
  const now = new Date();
  const { start, end } = istDayBounds(now);

  const userFilter = people ? { username: { $in: people } } : {};
  const [users, names] = await Promise.all([
    usersCollection().find(userFilter, { projection: { username: 1, department: 1 } }).toArray(),
    deptNames(),
  ]);
  const tasks: any[] = await Task.find({
    isDeleted: { $ne: true },
    ...(people ? { assignee: { $in: people } } : {}),
    $or: [
      { status: { $in: ACTIVE_STATUSES } },
      { completedAt: { $gte: start } },
      sessionsTouching(start, end),
    ],
  }).limit(MAX_TASKS).lean();

  const members = new Map<string, BoardMemberDTO>();
  const member = (username: string, department: string | null = null) => {
    let m = members.get(username);
    if (!m) {
      m = {
        username, department, state: "idle", working: [], paused: [], next: null,
        counts: { open: 0, inProgress: 0, paused: 0, waiting: 0, overdue: 0, notSeen: 0, urgent: 0, doneToday: 0 },
        workedTodaySeconds: 0,
      };
      members.set(username, m);
    }
    return m;
  };
  for (const u of users as any[]) member(u.username, u.department || null);

  const pending = new Map<string, any[]>();
  for (const t of tasks) {
    const m = member(t.assignee);
    for (const s of t.workSessions || []) m.workedTodaySeconds += overlapSeconds(s, start, end, now);
    if (t.completedAt && new Date(t.completedAt) >= start && ["DONE", "CLOSED"].includes(t.status)) m.counts.doneToday++;
    if (!ACTIVE_STATUSES.includes(t.status)) continue;

    if (t.status === "OPEN") m.counts.open++;
    if (t.status === "IN_PROGRESS") { m.counts.inProgress++; m.working.push(boardTask(t)); }
    if (t.status === "PAUSED") { m.counts.paused++; m.paused.push(boardTask(t)); }
    if (t.status === "WAITING") m.counts.waiting++;
    if (new Date(t.dueAt) < now) m.counts.overdue++;
    if (t.priority === "URGENT") m.counts.urgent++;
    if (t.status === "OPEN" && !t.seenAt && t.assignee !== t.assignedBy) m.counts.notSeen++;
    if (t.status === "OPEN" || t.status === "PAUSED") pending.set(t.assignee, [...(pending.get(t.assignee) || []), t]);
  }

  for (const m of members.values()) {
    m.state = m.working.length ? "working" : m.paused.length ? "paused" : "idle";
    m.working.sort(byUrgencyThenDue);
    m.paused.sort(byUrgencyThenDue);
    const next = (pending.get(m.username) || []).sort(byUrgencyThenDue)[0];
    m.next = next ? boardTask(next) : null;
  }

  const rank = { working: 0, paused: 1, idle: 2 } as const;
  const list = [...members.values()].sort(
    (a, b) => b.counts.urgent - a.counts.urgent || rank[a.state] - rank[b.state] || b.counts.overdue - a.counts.overdue || a.username.localeCompare(b.username)
  );
  const usedDepts = new Set(list.map((m) => m.department).filter(Boolean) as string[]);
  return {
    generatedAt: now.toISOString(),
    members: list,
    departments: [...usedDepts].map((id) => ({ _id: id, name: names.get(id) || "?" })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ----------------------------------------------------------- monthly report */

const MONTH_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: istDateTime(`${month}-01`, "00:00"), to: istDateTime(`${next}-01`, "00:00") };
}

interface Acc extends ReportRowDTO { _hours: number; _n: number }

const emptyRow = (key: string, name: string, department?: string | null): Acc => ({
  key, name, ...(department !== undefined ? { department } : {}),
  assigned: 0, dueInMonth: 0, completed: 0, onTime: 0, late: 0, onTimePct: null, pendingOverdue: 0, rejected: 0,
  urgentDone: 0, fixedDue: 0, fixedDone: 0, workSeconds: 0, avgCompletionHours: null, _hours: 0, _n: 0,
});

const NUM_KEYS = ["assigned", "dueInMonth", "completed", "onTime", "late", "pendingOverdue", "rejected", "urgentDone", "fixedDue", "fixedDone", "workSeconds", "_hours", "_n"] as const;

function addInto(into: Acc, r: Acc) {
  for (const k of NUM_KEYS) (into as any)[k] += (r as any)[k];
}

function finish(r: Acc): ReportRowDTO {
  r.onTimePct = r.completed ? Math.round((r.onTime / r.completed) * 100) : null;
  r.avgCompletionHours = r._n ? Math.round((r._hours / r._n) * 10) / 10 : null;
  const { _hours, _n, ...row } = r;
  return row;
}

/** GET /api/reports/monthly?month=YYYY-MM - per user + per department (admin). */
export async function monthlyReport(actor: TaskActor, monthRaw: string | null): Promise<MonthlyReportDTO> {
  if (actor.role !== "admin") throw new TaskError(403, "Reports sirf admin dekh sakta hai");
  const month = monthRaw || istDateKey().slice(0, 7);
  if (!MONTH_RX.test(month)) throw new TaskError(400, "Month YYYY-MM format mein do (jaise 2026-11)");
  const { from, to } = monthBounds(month);
  const now = new Date();
  const inMonth = { $gte: from, $lt: to };

  const [users, names, tasks, rejects] = await Promise.all([
    usersCollection().find({}, { projection: { username: 1, department: 1 } }).toArray(),
    deptNames(),
    Task.find({
      isDeleted: { $ne: true },
      $or: [{ createdAt: inMonth }, { completedAt: inMonth }, { dueAt: inMonth }, sessionsTouching(from, to)],
    }).limit(MAX_TASKS).lean() as Promise<any[]>,
    TaskActivity.find({ type: "REJECTED", createdAt: inMonth }, { taskId: 1 }).lean() as Promise<any[]>,
  ]);

  const deptOf = new Map<string, string | null>((users as any[]).map((u) => [u.username, u.department || null]));
  const rows = new Map<string, Acc>();
  const row = (u: string) => {
    let r = rows.get(u);
    if (!r) { r = emptyRow(u, u, deptOf.get(u) ?? null); rows.set(u, r); }
    return r;
  };
  for (const u of users as any[]) row(u.username);

  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  for (const t of tasks) {
    const r = row(t.assignee);
    const created = new Date(t.createdAt), due = new Date(t.dueAt);
    const completed = t.completedAt ? new Date(t.completedAt) : null;
    const dueIn = due >= from && due < to && t.status !== "CANCELLED";

    if (created >= from && created < to) r.assigned++;
    if (dueIn) {
      r.dueInMonth++;
      if (ACTIVE_STATUSES.includes(t.status) && due < now) r.pendingOverdue++;
      if (t.source === "RECURRING") { r.fixedDue++; if (completed) r.fixedDone++; }
    }
    if (completed && completed >= from && completed < to && ["DONE", "CLOSED"].includes(t.status)) {
      r.completed++;
      if (completed <= due) r.onTime++; else r.late++;
      if (t.priority === "URGENT") r.urgentDone++;
      r._hours += (completed.getTime() - created.getTime()) / 3_600_000;
      r._n++;
    }
    for (const s of t.workSessions || []) r.workSeconds += overlapSeconds(s, from, to, now);
  }

  // Rejections: attribute to the task's (current) assignee.
  const missing = [...new Set(rejects.map((a) => a.taskId).filter((id) => !byId.has(id)))];
  if (missing.length) {
    const extra: any[] = await Task.find({ _id: { $in: missing } }, { assignee: 1 }).lean();
    for (const t of extra) byId.set(String(t._id), t);
  }
  for (const a of rejects) {
    const t = byId.get(a.taskId);
    if (t) row(t.assignee).rejected++;
  }

  const depts = new Map<string, Acc>();
  const total = emptyRow("", "Total");
  for (const r of rows.values()) {
    const d = r.department || "";
    if (!depts.has(d)) depts.set(d, emptyRow(d, d ? names.get(d) || "?" : "No department"));
    addInto(depts.get(d)!, r);
    addInto(total, r);
  }

  const order = (a: ReportRowDTO, b: ReportRowDTO) => b.completed - a.completed || b.assigned - a.assigned || a.name.localeCompare(b.name);
  return {
    month,
    from: from.toISOString(),
    to: to.toISOString(),
    users: [...rows.values()].map(finish).sort(order),
    departments: [...depts.values()].map(finish).sort(order),
    total: finish(total),
  };
}
