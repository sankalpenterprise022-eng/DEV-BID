import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import Task from "@/models/Task";
import TaskTemplate from "@/models/TaskTemplate";
import Department from "@/models/Department";
import Counter from "@/models/Counter";
import { generateTaskNo } from "./taskNumber";
import { addDaysKey, istDateKey, istDateTime, istDayBounds, isDateKey } from "./ist";
import { TaskActor, TaskError, canAssignTo, isManagerOrAdmin, managerSeesAll, usersCollection } from "./permissions";
import { existingUsernames, logActivity, pauseForUrgent } from "./taskService";
import { assertDepartmentIds, loadCalendar } from "./orgService";
import {
  DEFAULT_DAILY_DAYS, MonthDate, RECURRENCE_TYPES, TemplateRecurrence, describeRecurrence, occurrencesDueForCreation,
  previewOccurrences,
} from "./recurrence";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "./types";

// Task templates = fixed/recurring work. Each occurrence becomes a normal Task
// per assignee (source "RECURRING", recurrence.templateId/occurrenceDate).

const CONFLICT_MSG = "Template kisi aur ne update kiya hai, refresh karo";
const TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LEAD_DAYS = 60;

const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function requireTemplateAccess(actor: TaskActor) {
  if (!isManagerOrAdmin(actor)) throw new TaskError(403, "Fixed tasks (templates) sirf manager/admin ke liye hain");
}

const canEdit = (actor: TaskActor, t: any) => actor.role === "admin" || t.createdBy === actor.username;
/** Whole-department targeting reaches people outside a manager's team, so only admin / see-all managers. */
const canUseDepartments = (actor: TaskActor) => actor.role === "admin" || managerSeesAll(actor);

function toDTO(actor: TaskActor, t: any) {
  return { ...t, _id: String(t._id), editable: canEdit(actor, t) };
}

/* -------------------------------------------------------------- validation */

const uniqInts = (raw: any, min: number, max: number) =>
  [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b);

export function cleanRecurrence(raw: any): TemplateRecurrence {
  const type = raw?.type;
  if (!RECURRENCE_TYPES.includes(type)) throw new TaskError(400, "Repeat type chuno (Daily / Weekly / Monthly / Yearly)");

  const leadDays = Number(raw?.leadDays ?? 0);
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > MAX_LEAD_DAYS) {
    throw new TaskError(400, `Lead days 0 se ${MAX_LEAD_DAYS} ke beech hona chahiye`);
  }
  const holidayShift = raw?.holidayShift === "next" ? "next" : "previous";
  const r: TemplateRecurrence = { type, daysOfWeek: [], datesOfMonth: [], monthDay: null, leadDays, holidayShift };

  if (type === "daily") {
    r.daysOfWeek = uniqInts(raw?.daysOfWeek, 0, 6);
    if (!r.daysOfWeek.length) r.daysOfWeek = [...DEFAULT_DAILY_DAYS];
  } else if (type === "weekly") {
    r.daysOfWeek = uniqInts(raw?.daysOfWeek, 0, 6);
    if (!r.daysOfWeek.length) throw new TaskError(400, "Weekly ke liye kam se kam ek din chuno");
  } else if (type === "monthly") {
    const list: any[] = Array.isArray(raw?.datesOfMonth) ? raw.datesOfMonth : [];
    const nums = uniqInts(list.filter((x) => x !== "last"), 1, 31);
    r.datesOfMonth = [...nums, ...(list.includes("last") ? (["last"] as MonthDate[]) : [])];
    if (!r.datesOfMonth.length) throw new TaskError(400, "Monthly ke liye kam se kam ek date chuno");
  } else {
    const month = Number(raw?.monthDay?.month);
    const day = Number(raw?.monthDay?.day);
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!maxDay || !Number.isInteger(day) || day < 1 || day > maxDay) throw new TaskError(400, "Yearly ke liye sahi month aur date chuno");
    r.monthDay = { month, day };
  }
  return r;
}

async function cleanTemplate(actor: TaskActor, body: any) {
  const title = str(body?.title, 200);
  if (!title) throw new TaskError(400, "Title zaroori hai");

  const priority = body?.priority ?? "NORMAL";
  if (!TASK_PRIORITIES.includes(priority)) throw new TaskError(400, "Priority sahi nahi hai");
  const category = body?.category ?? "GENERAL";
  if (!TASK_CATEGORIES.includes(category)) throw new TaskError(400, "Category sahi nahi hai");

  const dueTime = str(body?.dueTime, 5) || "18:00";
  if (!TIME_RX.test(dueTime)) throw new TaskError(400, "Due time HH:mm format mein do (jaise 18:00)");

  const rawChecklist: any[] = Array.isArray(body?.checklist) ? body.checklist : typeof body?.checklist === "string" ? body.checklist.split("\n") : [];
  const checklist = rawChecklist.map((c) => str(typeof c === "string" ? c : c?.text, 300)).filter(Boolean).slice(0, 50);

  const names = [...new Set((Array.isArray(body?.assignees) ? body.assignees : []).map((a: any) => str(a, 100)).filter(Boolean))] as string[];
  const known = await existingUsernames(names);
  const missing = names.find((n) => !known.has(n));
  if (missing) throw new TaskError(400, `User "${missing}" nahi mila`);
  const notAllowed = names.find((n) => !canAssignTo(actor, n));
  if (notAllowed) throw new TaskError(403, `Aap sirf apni team ko task assign kar sakte ho ("${notAllowed}")`);

  const deptIds = (Array.isArray(body?.departments) ? body.departments : []).map((d: any) => str(d, 50)).filter(Boolean);
  if (deptIds.length && !canUseDepartments(actor)) throw new TaskError(403, "Poore department ko sirf admin assign kar sakta hai");
  const departments = await assertDepartmentIds(deptIds);

  if (!names.length && !departments.length) throw new TaskError(400, "Kam se kam ek user ya department chuno");

  return {
    title,
    description: str(body?.description, 5000),
    category,
    priority,
    checklist,
    assignees: names,
    departments,
    dueTime,
    requiresVerification: typeof body?.requiresVerification === "boolean" ? body.requiresVerification : true,
    recurrence: cleanRecurrence(body?.recurrence),
    active: typeof body?.active === "boolean" ? body.active : true,
  };
}

/* --------------------------------------------------------------------- CRUD */

export async function listTemplates(actor: TaskActor) {
  requireTemplateAccess(actor);
  const rows = await TaskTemplate.find({}).sort({ active: -1, title: 1 }).lean();
  return { templates: rows.map((t) => toDTO(actor, t)), canUseDepartments: canUseDepartments(actor) };
}

export async function createTemplate(actor: TaskActor, body: any) {
  requireTemplateAccess(actor);
  const data = await cleanTemplate(actor, body);
  const t = await TaskTemplate.create({ ...data, createdBy: actor.username });
  // Today's / lead-day occurrences right away (not only at the next cron run).
  const gen = data.active ? await generateRecurringTasks(istDateKey(), { templateIds: [String(t._id)] }) : null;
  return { template: toDTO(actor, t.toObject()), created: gen?.created ?? 0 };
}

async function loadEditable(actor: TaskActor, id: string) {
  requireTemplateAccess(actor);
  if (!mongoose.isValidObjectId(id)) throw new TaskError(404, "Template nahi mila");
  const t: any = await TaskTemplate.findById(id).lean();
  if (!t) throw new TaskError(404, "Template nahi mila");
  if (!canEdit(actor, t)) throw new TaskError(403, "Sirf apna banaya template edit kar sakte ho");
  return t;
}

/** Full update (or just { active } for the toggle). Optimistic lock via expectedUpdatedAt. */
export async function updateTemplate(actor: TaskActor, id: string, body: any) {
  const t = await loadEditable(actor, id);
  if (body?.expectedUpdatedAt && new Date(body.expectedUpdatedAt).getTime() !== new Date(t.updatedAt).getTime()) {
    throw new TaskError(409, CONFLICT_MSG);
  }
  const onlyToggle = typeof body?.active === "boolean" && body.title === undefined;
  const set = onlyToggle ? { active: body.active } : await cleanTemplate(actor, body);

  const updated: any = await TaskTemplate.findOneAndUpdate({ _id: t._id, updatedAt: t.updatedAt }, { $set: set }, { new: true }).lean();
  if (!updated) throw new TaskError(409, CONFLICT_MSG);
  // Tasks already generated keep their old values; new settings apply from the next occurrence.
  const gen = updated.active ? await generateRecurringTasks(istDateKey(), { templateIds: [id] }) : null;
  return { template: toDTO(actor, updated), created: gen?.created ?? 0 };
}

/** Deletes the template only; tasks already generated from it stay as they are. */
export async function deleteTemplate(actor: TaskActor, id: string) {
  const t = await loadEditable(actor, id);
  await TaskTemplate.deleteOne({ _id: t._id });
  return { success: true };
}

/** POST /api/templates/preview { recurrence, dueTime } - next 5 dates without saving. */
export async function previewTemplate(actor: TaskActor, body: any) {
  requireTemplateAccess(actor);
  const r = cleanRecurrence(body?.recurrence);
  const dueTime = TIME_RX.test(body?.dueTime) ? body.dueTime : "18:00";
  const today = istDateKey();
  const cal = await loadCalendar(addDaysKey(today, -40), addDaysKey(today, 900));
  return {
    summary: describeRecurrence(r),
    dates: previewOccurrences(r, cal, today, 5).map((o) => ({ ...o, dueAt: istDateTime(o.dueDate, dueTime) })),
  };
}

/* --------------------------------------------------------------- generation */

let indexReady: Promise<unknown> | null = null;
/**
 * The unique recurring index must exist before we rely on it for idempotency.
 * Created explicitly (same spec as models/Task.ts) instead of trusting
 * autoIndex, which can be skipped when a cached model is reused.
 */
function ensureIndexes() {
  indexReady ??= Task.collection
    .createIndex(
      { "recurrence.templateId": 1, assignee: 1, "recurrence.occurrenceDate": 1 },
      { unique: true, partialFilterExpression: { "recurrence.templateId": { $type: "string" } }, name: "recurring_occurrence_unique" }
    )
    .catch((e: any) => { indexReady = null; throw e; });
  return indexReady;
}

const RULE: Record<string, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };

/**
 * Create the Task documents for every active template whose occurrence should
 * exist on IST date `dateIST` (creation day reached, due day not passed).
 * Idempotent: an existing task for (template, assignee, occurrenceDate) is never
 * duplicated (pre-check + unique partial index). Called by the cron (Phase 4),
 * lazily via ensureRecurringTasks(), and right after a template is saved.
 */
export async function generateRecurringTasks(dateIST: string = istDateKey(), opts: { templateIds?: string[] } = {}) {
  if (!isDateKey(dateIST)) throw new TaskError(400, "Date sahi nahi hai (YYYY-MM-DD)");
  await dbConnect();
  await ensureIndexes();

  const filter: Record<string, any> = { active: true };
  if (opts.templateIds) filter._id = { $in: opts.templateIds.filter((id) => mongoose.isValidObjectId(id)) };
  const templates: any[] = await TaskTemplate.find(filter).lean();
  const result = { date: dateIST, templates: templates.length, created: 0, existing: 0, failed: 0 };
  if (!templates.length) return result;

  const maxLead = Math.max(0, ...templates.map((t) => t.recurrence?.leadDays || 0));
  const [cal, users, activeDepts] = await Promise.all([
    loadCalendar(addDaysKey(dateIST, -40), addDaysKey(dateIST, maxLead + 40)),
    usersCollection().find({}, { projection: { username: 1, department: 1 } }).toArray(),
    Department.find({ active: { $ne: false } }, { _id: 1 }).lean(),
  ]);
  const activeDeptIds = new Set(activeDepts.map((d: any) => String(d._id)));
  const known = await existingUsernames(templates.flatMap((t) => t.assignees || []));

  for (const t of templates) {
    const occs = occurrencesDueForCreation(t.recurrence, cal, dateIST);
    if (!occs.length) continue;

    // Explicit assignees + current members of the template's (active) departments.
    const people = new Set<string>((t.assignees || []).filter((u: string) => known.has(u)));
    const depts = new Set<string>((t.departments || []).filter((d: string) => activeDeptIds.has(d)));
    for (const u of users) if (u.department && depts.has(u.department)) people.add(u.username);
    if (!people.size) continue;

    const templateId = String(t._id);
    const existing = await Task.find(
      { "recurrence.templateId": templateId, "recurrence.occurrenceDate": { $in: occs.map((o) => o.occurrenceDate) } },
      { assignee: 1, "recurrence.occurrenceDate": 1 }
    ).lean();
    const have = new Set(existing.map((e: any) => `${e.assignee}|${e.recurrence?.occurrenceDate}`));
    const label = describeRecurrence(t.recurrence);

    for (const occ of occs) {
      const dueAt = istDateTime(occ.dueDate, t.dueTime || "18:00");
      for (const assignee of people) {
        if (have.has(`${assignee}|${occ.occurrenceDate}`)) { result.existing++; continue; }
        try {
          const task = await Task.create({
            taskNo: await generateTaskNo(),
            title: t.title,
            description: t.description || "",
            category: t.category,
            priority: t.priority,
            assignedBy: t.createdBy,
            assignee,
            watchers: [],
            dueAt,
            requiresVerification: t.requiresVerification !== false,
            checklist: (t.checklist || []).map((text: string) => ({ text, done: false })),
            source: "RECURRING",
            recurrence: { enabled: true, rule: RULE[t.recurrence.type], templateId, occurrenceDate: occ.occurrenceDate },
          });
          await logActivity(task._id, null, "CREATED", `Fixed task auto-bana (${label}), ${assignee} ko`, null, {
            assignee, dueAt, templateId, occurrenceDate: occ.occurrenceDate,
          });
          result.created++;
          if (t.priority === "URGENT") await pauseForUrgent(task.toObject());
        } catch (e: any) {
          if (e?.code === 11000) { result.existing++; continue; } // parallel run created it first
          result.failed++;
          console.error(`Recurring task create fail (template ${templateId}, ${assignee}, ${occ.occurrenceDate}):`, e);
        }
      }
    }
  }
  return result;
}

const LAZY_RUN_ID = "recurring-lastrun";
const LAZY_GAP_MS = 10 * 60 * 1000;

/**
 * Backup for a missed cron: run generation for today when someone opens the
 * Tasks page, at most once per 10 min (and always on the first open of a new
 * IST day). The gate is an atomic doc in `counters`, so it works across
 * serverless instances.
 */
export async function ensureRecurringTasks(_actor: TaskActor) {
  const now = Date.now();
  const todayStart = istDayBounds(new Date(now)).start.getTime();
  let claimed = false;
  try {
    claimed = !!(await Counter.findOneAndUpdate(
      { _id: LAZY_RUN_ID, seq: { $lt: Math.max(now - LAZY_GAP_MS, todayStart) } },
      { $set: { seq: now } },
      { upsert: true, new: true }
    ));
  } catch (e: any) {
    if (e?.code !== 11000) throw e; // 11000 = doc exists and was run recently
  }
  if (!claimed) return { ran: false, created: 0 };
  const r = await generateRecurringTasks(istDateKey(new Date(now)));
  return { ran: true, created: r.created };
}
