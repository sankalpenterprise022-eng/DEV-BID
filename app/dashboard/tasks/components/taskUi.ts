import type { TaskPriority, TaskRole, TaskStatus, TaskUserDTO } from "@/lib/tasks/types";
import { handleSessionExpired } from "@/lib/auth/clientSession";

/* ---------------------------------------------------------------- session */

export interface SessionUser {
  username: string;
  permissions?: Record<string, boolean>;
}

export function readSessionUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem("oms_user");
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.username ? u : null;
  } catch {
    return null;
  }
}

/** Mirrors lib/tasks/permissions.ts getTaskRole (+ the hardcoded super-admins) for first paint. */
export function roleFromSession(u: SessionUser | null): TaskRole {
  if (!u) return "staff";
  if (["admin", "chintan", "hitesh"].includes(u.username.toLowerCase()) || u.permissions?.boss) return "admin";
  return u.permissions?.taskManager ? "manager" : "staff";
}

export interface TaskCtx {
  me: string;
  role: TaskRole;
  users: TaskUserDTO[];
  notify: (msg: string, kind?: "ok" | "err") => void;
}

/* -------------------------------------------------------------------- api */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** `_me` is kept for call-site compatibility only: identity is the httpOnly session cookie. */
export async function api<T = any>(path: string, _me: string, init: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) handleSessionExpired();
  if (!res.ok) throw new ApiError(res.status, data?.error || "Request fail ho gayi");
  return data as T;
}

/* ---------------------------------------------------------------- display */

export const STATUS_META: Record<TaskStatus, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  IN_PROGRESS: { label: "In Progress", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  PAUSED: { label: "Paused", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  WAITING: { label: "Waiting", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  DONE: { label: "Done (verify)", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  CLOSED: { label: "Closed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-rose-50 text-rose-400 border-rose-200 line-through" },
};

export const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  LOW: { label: "Low", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  NORMAL: { label: "Normal", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  HIGH: { label: "High", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  URGENT: { label: "Urgent", cls: "bg-red-50 text-red-700 border-red-300" },
};

export const CATEGORY_LABEL = (c: string) => c.replace(/_/g, " ").toLowerCase();

/** 🔁 Daily / 📅 Weekly / 🗓️ Monthly / 📆 Yearly for template-generated tasks, 📌 Assigned otherwise. */
export function taskKindBadge(t: { source?: string; recurrence?: { rule?: string | null } }): { label: string; cls: string; title: string } {
  if (t.source === "RECURRING") {
    const rule = t.recurrence?.rule;
    const label = rule === "WEEKLY" ? "📅 Weekly" : rule === "MONTHLY" ? "🗓️ Monthly" : rule === "YEARLY" ? "📆 Yearly" : "🔁 Daily";
    return { label, cls: "bg-indigo-50 text-indigo-700 border-indigo-200", title: "Fixed / recurring task (template se bana)" };
  }
  return { label: "📌 Assigned", cls: "bg-slate-50 text-slate-500 border-slate-200", title: "Ek baar ka assigned task" };
}

/** "Mon, 03-Nov-2026" for an IST date key "YYYY-MM-DD". */
export function fmtDateKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  if (isNaN(d.getTime())) return key;
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d).replace(/ /g, "-");
  return `${wd}, ${day}`;
}

const IST = "Asia/Kolkata";

/** dd-MMM-yyyy hh:mm a, in IST. */
export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" })
    .format(date).replace(/ /g, "-");
  const time = new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
  return `${day} ${time}`;
}

const istDayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d); // YYYY-MM-DD
const istTime = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(d);

export const ACTIVE = ["OPEN", "IN_PROGRESS", "PAUSED", "WAITING"];

/** Urgent + still pending: sorted on top and highlighted red. */
export const isUrgentActive = (t: { priority: string; status: string }) => t.priority === "URGENT" && ACTIVE.includes(t.status);

/** Toast suffix when an urgent task auto-paused someone's running work. */
export const autoPausedNote = (list?: { taskNo: string; assignee: string }[]) =>
  list?.length ? ` ⏸ Auto-pause: ${list.map((p) => `${p.taskNo} (${p.assignee})`).join(", ")}` : "";

/* ------------------------------------------------------- seen / work time */

/** "Not seen" chip: OPEN, never opened by the assignee, and not a self-task (same rule as the server's notSeen stat). */
export const isNotSeen = (t: { status: string; seenAt?: string; assignee: string; assignedBy: string }) =>
  t.status === "OPEN" && !t.seenAt && t.assignee !== t.assignedBy;

/** Closed sessions + the running one (if IN_PROGRESS), in seconds. */
export function workSecondsNow(t: { totalWorkSeconds?: number; workSessions?: { start: string; end?: string }[] }, now = Date.now()): number {
  const s = t.workSessions || [];
  const last = s[s.length - 1];
  const running = last && !last.end ? Math.max(0, Math.floor((now - new Date(last.start).getTime()) / 1000)) : 0;
  return (t.totalWorkSeconds || 0) + running;
}

/** 1h 25m · 12m · 45s · 0m */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return s ? `${s}s` : "0m";
}

/** Checklist done %, or null when there is no checklist. */
export function checklistPct(t: { checklist?: { done: boolean }[] }): number | null {
  const c = t.checklist || [];
  return c.length ? Math.round((c.filter((x) => x.done).length / c.length) * 100) : null;
}

export const PAUSE_REASONS = ["Lunch / break", "Doosra kaam aaya", "Meeting", "Info ka wait", "Kal karunga"];
export const isOverdue = (t: { status: string; dueAt: string }) => ACTIVE.includes(t.status) && new Date(t.dueAt).getTime() < Date.now();

/** "Today 5:00 PM", "Tomorrow 10:00 AM", "2 days overdue", "3h overdue". */
export function relativeDue(t: { status: string; dueAt: string }): { text: string; overdue: boolean } {
  const due = new Date(t.dueAt);
  const now = new Date();
  if (isOverdue(t)) {
    const mins = Math.floor((now.getTime() - due.getTime()) / 60000);
    if (mins < 60) return { text: `${Math.max(mins, 1)}m overdue`, overdue: true };
    if (mins < 24 * 60) return { text: `${Math.floor(mins / 60)}h overdue`, overdue: true };
    const days = Math.floor(mins / (24 * 60));
    return { text: `${days} day${days > 1 ? "s" : ""} overdue`, overdue: true };
  }
  const dayDiff = Math.round((Date.parse(istDayKey(due)) - Date.parse(istDayKey(now))) / 86400000);
  if (dayDiff === 0) return { text: `Today ${istTime(due)}`, overdue: false };
  if (dayDiff === 1) return { text: `Tomorrow ${istTime(due)}`, overdue: false };
  return { text: fmtDateTime(due), overdue: false };
}

/* ------------------------------------------------------------ date chips */

const pad = (n: number) => String(n).padStart(2, "0");

/** Value for <input type="datetime-local"> (browser-local time; OMS users are in IST). */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const atHour = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const DUE_CHIPS: { label: string; get: () => Date }[] = [
  { label: "Today EOD", get: () => { const d = atHour(new Date(), 19); return d.getTime() > Date.now() ? d : atHour(new Date(), 23, 59); } },
  { label: "Tomorrow", get: () => atHour(addDays(new Date(), 1), 18) },
  { label: "3 days", get: () => atHour(addDays(new Date(), 3), 18) },
  { label: "Next week", get: () => atHour(addDays(new Date(), 7), 18) },
];

export const FOLLOWUP_CHIPS: { label: string; get: () => Date }[] = [
  { label: "Tomorrow", get: () => atHour(addDays(new Date(), 1), 10) },
  { label: "2 days", get: () => atHour(addDays(new Date(), 2), 10) },
  {
    label: "Next Mon",
    get: () => { const now = new Date(); const diff = ((8 - now.getDay()) % 7) || 7; return atHour(addDays(now, diff), 10); },
  },
  { label: "1 week", get: () => atHour(addDays(new Date(), 7), 10) },
];
