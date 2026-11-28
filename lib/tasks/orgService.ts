import mongoose from "mongoose";
import Department from "@/models/Department";
import Holiday from "@/models/Holiday";
import TaskSettings from "@/models/TaskSettings";
import { TaskActor, TaskError, usersCollection } from "./permissions";
import { isDateKey } from "./ist";
import type { WorkCalendar } from "./recurrence";

// Departments + holidays (routes stay thin: getActor() -> one function here).

export const SEED_DEPARTMENTS = ["Accounts", "Link Generator", "Order Entry", "Dispatch", "Bid"];

const str = (v: any, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function requireAdmin(actor: TaskActor, what: string) {
  if (actor.role !== "admin") throw new TaskError(403, `${what} sirf admin kar sakta hai`);
}

function isDuplicate(e: any) {
  return e?.code === 11000;
}

/* -------------------------------------------------------------- departments */

let seeding: Promise<unknown> | null = null;
/** Insert the default departments once, when the collection is empty. */
async function seedDepartmentsIfEmpty() {
  if (await Department.estimatedDocumentCount()) return;
  seeding ??= Department.insertMany(SEED_DEPARTMENTS.map((name) => ({ name })), { ordered: false })
    .catch((e) => { if (!isDuplicate(e)) throw e; })
    .finally(() => { seeding = null; });
  await seeding;
}

/** GET /api/departments - every logged-in user (dropdowns); members = usernames. */
export async function listDepartments(_actor: TaskActor) {
  await seedDepartmentsIfEmpty();
  const [depts, users] = await Promise.all([
    Department.find({}).sort({ name: 1 }).lean(),
    usersCollection().find({ department: { $type: "string" } }, { projection: { username: 1, department: 1 } }).toArray(),
  ]);
  return depts.map((d: any) => ({
    _id: String(d._id),
    name: d.name,
    active: d.active !== false,
    members: users.filter((u: any) => u.department === String(d._id)).map((u: any) => u.username).sort(),
  }));
}

export async function createDepartment(actor: TaskActor, body: any) {
  requireAdmin(actor, "Department banana");
  const name = str(body?.name, 60);
  if (!name) throw new TaskError(400, "Department ka naam zaroori hai");
  try {
    const d = await Department.create({ name });
    return { department: d.toObject() };
  } catch (e) {
    if (isDuplicate(e)) throw new TaskError(400, `"${name}" department pehle se hai`);
    throw e;
  }
}

/** Rename and/or activate/deactivate. An inactive department gets no new fixed tasks. */
export async function updateDepartment(actor: TaskActor, id: string, body: any) {
  requireAdmin(actor, "Department edit");
  if (!mongoose.isValidObjectId(id)) throw new TaskError(404, "Department nahi mila");
  const set: Record<string, any> = {};
  if (body?.name !== undefined) {
    const name = str(body.name, 60);
    if (!name) throw new TaskError(400, "Department ka naam khali nahi ho sakta");
    set.name = name;
  }
  if (typeof body?.active === "boolean") set.active = body.active;
  if (!Object.keys(set).length) throw new TaskError(400, "Kuch change nahi bheja");
  try {
    const d = await Department.findByIdAndUpdate(id, { $set: set }, { new: true }).lean();
    if (!d) throw new TaskError(404, "Department nahi mila");
    return { department: d };
  } catch (e) {
    if (isDuplicate(e)) throw new TaskError(400, `"${set.name}" department pehle se hai`);
    throw e;
  }
}

/** Validate a department id coming from a form (users / create task / templates). */
export async function assertDepartmentIds(ids: string[], { activeOnly = false } = {}) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  if (unique.some((id) => !mongoose.isValidObjectId(id))) throw new TaskError(400, "Department sahi nahi hai");
  const found = await Department.find({ _id: { $in: unique }, ...(activeOnly ? { active: { $ne: false } } : {}) }, { _id: 1 }).lean();
  if (found.length !== unique.length) throw new TaskError(400, activeOnly ? "Department nahi mila ya band hai" : "Department nahi mila");
  return unique;
}

/* ----------------------------------------------------------------- holidays */

/** GET /api/holidays?year=2026 - every logged-in user. */
export async function listHolidays(_actor: TaskActor, year?: string | null) {
  const filter = year && /^\d{4}$/.test(year) ? { date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } : {};
  const rows = await Holiday.find(filter).sort({ date: 1 }).lean();
  return rows.map((h: any) => ({ _id: String(h._id), date: h.date, name: h.name }));
}

export async function createHoliday(actor: TaskActor, body: any) {
  requireAdmin(actor, "Holiday add");
  const date = body?.date;
  if (!isDateKey(date)) throw new TaskError(400, "Date sahi nahi hai (YYYY-MM-DD)");
  const name = str(body?.name, 100);
  if (!name) throw new TaskError(400, "Holiday ka naam zaroori hai");
  try {
    const h = await Holiday.create({ date, name, createdBy: actor.username });
    return { holiday: { _id: String(h._id), date: h.date, name: h.name } };
  } catch (e) {
    if (isDuplicate(e)) throw new TaskError(400, `${date} pehle se holiday hai`);
    throw e;
  }
}

export async function deleteHoliday(actor: TaskActor, id: string) {
  requireAdmin(actor, "Holiday delete");
  if (!mongoose.isValidObjectId(id)) throw new TaskError(404, "Holiday nahi mila");
  const r = await Holiday.deleteOne({ _id: id });
  if (!r.deletedCount) throw new TaskError(404, "Holiday nahi mila");
  return { success: true };
}

/* ----------------------------------------------------------------- calendar */

/** Holidays in [from, to] + TaskSettings.workingDays (default Mon-Sat => Sunday is off). */
export async function loadCalendar(from: string, to: string): Promise<WorkCalendar> {
  const [holidays, settings] = await Promise.all([
    Holiday.find({ date: { $gte: from, $lte: to } }, { date: 1 }).lean(),
    TaskSettings.findById("default").lean(),
  ]);
  const wd = (settings as any)?.workingDays;
  return {
    holidays: new Set(holidays.map((h: any) => h.date)),
    workingDays: Array.isArray(wd) && wd.length ? wd : [1, 2, 3, 4, 5, 6],
  };
}
