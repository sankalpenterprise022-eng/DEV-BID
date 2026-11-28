// Shared task types/enums for the API routes and the dashboard UI.

export const TASK_STATUSES = ["OPEN", "IN_PROGRESS", "PAUSED", "WAITING", "DONE", "CLOSED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = [
  "ORDER", "DELIVERY", "BILLING", "PAYMENT_FOLLOWUP", "BID",
  "GEM_CATALOGUE", "DOCUMENT", "PURCHASE", "ACCOUNTS", "GENERAL",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const WAITING_ON = ["BUYER", "STAFF", "MATERIAL", "PAYMENT", "OTHER"] as const;
export type WaitingOn = (typeof WAITING_ON)[number];

export type TaskRole = "admin" | "manager" | "staff";

/** Statuses in which a task is still live (overdue clock runs). PAUSED is live: the work is only on hold. */
export const ACTIVE_STATUSES: TaskStatus[] = ["OPEN", "IN_PROGRESS", "PAUSED", "WAITING"];

/** Statuses that no longer count as "pending" for the navbar badge: DONE = "Done (verify)",
 *  CLOSED = "Done", CANCELLED = no longer anybody's work. Edit here to change the badge rule. */
export const DONE_STATUSES: TaskStatus[] = ["DONE", "CLOSED", "CANCELLED"];

/** Single source of truth for lifecycle transitions made via the status route.
 *  DONE -> CLOSED/IN_PROGRESS go through verify/reject, CLOSED -> OPEN through reopen. */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING", "DONE", "CANCELLED"],
  IN_PROGRESS: ["PAUSED", "WAITING", "DONE", "CANCELLED"],
  PAUSED: ["IN_PROGRESS", "WAITING", "DONE", "CANCELLED"], // pause needs a reason; IN_PROGRESS = Resume
  WAITING: ["IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: ["CLOSED", "IN_PROGRESS"],
  CLOSED: ["OPEN"],
  CANCELLED: [],
};

export interface ChecklistItemDTO {
  _id?: string;
  text: string;
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

export interface TaskDTO {
  _id: string;
  taskNo: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  firm: string;
  links: {
    sellerOrderId?: string; gemOrderNo?: string; bidId?: string; bidNo?: string;
    billId?: string; billNo?: string; buyerName?: string; buyerPhone?: string;
  };
  assignedBy: string;
  assignee: string;
  watchers: string[];
  dueAt: string;
  startedAt?: string;
  completedAt?: string;
  closedAt?: string;
  closedBy?: string;
  requiresVerification: boolean;
  waitingOn: WaitingOn | null;
  nextFollowUpAt?: string;
  followUpCount: number;
  checklist: ChecklistItemDTO[];
  /** When the assignee first opened / acknowledged it. Missing = not seen yet. */
  seenAt?: string;
  /** Actual working periods. The last one has no `end` while IN_PROGRESS. */
  workSessions?: WorkSessionDTO[];
  /** Sum of closed sessions (pauses + waiting excluded). */
  totalWorkSeconds?: number;
  /** "RECURRING" = generated from a task template (fixed work); anything else = assigned. */
  source?: string;
  recurrence?: { enabled?: boolean; rule?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null; templateId?: string; occurrenceDate?: string };
  createdAt: string;
  updatedAt: string;
}

/** Task list filter: fixed (template-generated) vs. one-off assigned work. */
export const TASK_KINDS = ["recurring", "assigned"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface DepartmentDTO {
  _id: string;
  name: string;
  active: boolean;
  members: string[];
}

export interface HolidayDTO {
  _id: string;
  date: string; // IST "YYYY-MM-DD"
  name: string;
}

export interface TaskTemplateDTO {
  _id: string;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskPriority;
  checklist: string[];
  assignees: string[];
  departments: string[];
  dueTime: string;
  requiresVerification: boolean;
  recurrence: import("./recurrence").TemplateRecurrence;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** May the current user edit/delete it. */
  editable: boolean;
}

export interface WorkSessionDTO {
  start: string;
  end?: string;
  /** Why the session ended (pause reason / "Waiting: BUYER" / ...). Empty for Done. */
  pauseReason?: string;
}

export interface TaskActivityDTO {
  _id: string;
  taskId: string;
  by: string | null;
  type: string;
  from?: any;
  to?: any;
  text: string;
  createdAt: string;
}

export interface TaskUserDTO {
  username: string;
  role: TaskRole;
  managerUsername: string | null;
  /** Department _id or null. */
  department: string | null;
  openCount: number;
  /** Whether the acting user may assign tasks to this person. */
  assignable: boolean;
}

export interface TaskSummaryDTO {
  open: number;
  dueToday: number;
  overdue: number;
  waiting: number;
  followUpsToday: number;
  toVerify: number;
  paused: number;
  notSeen: number;
}

export type TaskStatKey = "open" | "dueToday" | "overdue" | "waiting" | "followUpsToday" | "toVerify" | "paused" | "notSeen";

/* ---------------------------------------------------- team board (Phase 5) */

export interface BoardTaskDTO {
  _id: string;
  taskNo: string;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string;
  /** Start of the running work session (IN_PROGRESS only). */
  sessionStart?: string;
  totalWorkSeconds: number;
  pauseReason?: string;
}

export interface BoardMemberDTO {
  username: string;
  department: string | null;
  state: "working" | "paused" | "idle";
  working: BoardTaskDTO[];
  paused: BoardTaskDTO[];
  /** Most urgent pending task to look at next (urgent first, then earliest due). */
  next: BoardTaskDTO | null;
  counts: { open: number; inProgress: number; paused: number; waiting: number; overdue: number; notSeen: number; urgent: number; doneToday: number };
  /** Work seconds inside today (IST), counting a running session up to `generatedAt`. */
  workedTodaySeconds: number;
}

export interface TeamBoardDTO {
  generatedAt: string;
  members: BoardMemberDTO[];
  departments: { _id: string; name: string }[];
}

/* ------------------------------------------------- monthly report (Phase 5) */

export interface ReportRowDTO {
  key: string; // username or department id ("" = no department)
  name: string;
  department?: string | null;
  assigned: number; // created in the month
  dueInMonth: number; // due in the month (not cancelled)
  completed: number; // completedAt in the month
  onTime: number; // completed in the month on/before due
  late: number;
  onTimePct: number | null;
  pendingOverdue: number; // due in the month, still not done, now past due
  rejected: number; // rework (REJECTED activities in the month)
  urgentDone: number;
  fixedDue: number; // recurring (fixed) tasks due in the month
  fixedDone: number; // ...of which completed
  workSeconds: number; // logged work time inside the month
  avgCompletionHours: number | null; // created -> done, for tasks completed in the month
}

export interface MonthlyReportDTO {
  month: string; // "YYYY-MM"
  from: string;
  to: string;
  users: ReportRowDTO[];
  departments: ReportRowDTO[];
  total: ReportRowDTO;
}
