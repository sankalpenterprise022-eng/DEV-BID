import mongoose from "mongoose";
import { hashPassword } from "@/lib/auth/password";
import { isHardcodedAdmin } from "@/lib/auth/session";
import { TaskActor, TaskError, canManageUsers, usersCollection } from "@/lib/tasks/permissions";
import { assertDepartmentIds } from "@/lib/tasks/orgService";
// Users page logic (routes stay thin: getActor() -> one function here).
// Passwords are bcrypt hashes and are never returned.

const NO_PASSWORD = { projection: { password: 0 } };
const FULL_PERMISSIONS = { boss: true, users: true, taskManager: true };

function requireUserAdmin(actor: TaskActor) {
  if (!canManageUsers(actor)) throw new TaskError(403, "Users page ki permission nahi hai");
}

function objectId(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new TaskError(400, "User id sahi nahi hai");
  return new mongoose.Types.ObjectId(id);
}

/** Keep only boolean flags; only an admin may hand out `boss`. */
function cleanPermissions(actor: TaskActor, raw: any, current: Record<string, boolean> = {}): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean" && /^\w{1,40}$/.test(k)) out[k] = v;
  }
  if (actor.role !== "admin" && (out.boss ?? false) !== (current.boss ?? false)) {
    throw new TaskError(403, "Super Admin permission sirf admin de ya hata sakta hai");
  }
  return out;
}

const cleanManager = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Department _id (must exist) or null. */
async function cleanDepartment(v: any): Promise<string | null> {
  const id = typeof v === "string" ? v.trim() : "";
  if (!id) return null;
  await assertDepartmentIds([id]);
  return id;
}

/** GET /api/users - full list for the Users page (no passwords). */
export async function listUsers(actor: TaskActor) {
  requireUserAdmin(actor);
  return usersCollection().find({}, NO_PASSWORD).sort({ username: 1 }).toArray();
}

/** GET /api/users?username=X - yourself, or anybody if you manage users. */
export async function getUserByName(actor: TaskActor, username: string) {
  if (username !== actor.username) requireUserAdmin(actor);
  const user = await usersCollection().findOne({ username }, NO_PASSWORD);
  if (user) return user;
  if (isHardcodedAdmin(username)) return { username, permissions: FULL_PERMISSIONS };
  throw new TaskError(404, "User nahi mila");
}

/** GET /api/me - who the session cookie says I am. */
export function me(actor: TaskActor) {
  return { username: actor.username, role: actor.role, permissions: actor.permissions };
}

export async function createUser(actor: TaskActor, body: any) {
  requireUserAdmin(actor);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password) throw new TaskError(400, "Username aur password zaroori hain");
  if (username.length > 100) throw new TaskError(400, "Username bahut lamba hai");
  // These names get full admin rights from the session, so a DB copy would be a backdoor.
  if (isHardcodedAdmin(username)) throw new TaskError(400, `"${username}" naam reserved hai`);

  const col = usersCollection();
  if (await col.findOne({ username }, { projection: { _id: 1 } })) throw new TaskError(400, "Username pehle se hai");

  await col.insertOne({
    username,
    password: await hashPassword(password),
    permissions: cleanPermissions(actor, body.permissions),
    managerUsername: cleanManager(body.managerUsername),
    department: await cleanDepartment(body.department),
    createdAt: new Date(),
  });
  return { message: "User ban gaya" };
}

/** Only password (blank = unchanged), permissions, managerUsername and department can change. */
export async function updateUser(actor: TaskActor, id: string, body: any) {
  requireUserAdmin(actor);
  const _id = objectId(id);
  const col = usersCollection();
  const target: any = await col.findOne({ _id }, NO_PASSWORD);
  if (!target) throw new TaskError(404, "User nahi mila");
  if (target.permissions?.boss && actor.role !== "admin") throw new TaskError(403, "Admin user ko sirf admin edit kar sakta hai");

  const set: Record<string, any> = {};
  if (typeof body?.password === "string" && body.password) set.password = await hashPassword(body.password);
  if (body?.permissions !== undefined) set.permissions = cleanPermissions(actor, body.permissions, target.permissions || {});
  if (body?.managerUsername !== undefined) set.managerUsername = cleanManager(body.managerUsername);
  // Joining a department: that department's fixed tasks start from the next generation run.
  if (body?.department !== undefined) set.department = await cleanDepartment(body.department);
  if (!Object.keys(set).length) return { message: "Kuch change nahi hua" };

  await col.updateOne({ _id }, { $set: set });
  return { message: "User update ho gaya" };
}

export async function deleteUser(actor: TaskActor, id: string) {
  requireUserAdmin(actor);
  const _id = objectId(id);
  const col = usersCollection();
  const target: any = await col.findOne({ _id }, NO_PASSWORD);
  if (!target) throw new TaskError(404, "User nahi mila");
  if (target.username === actor.username) throw new TaskError(400, "Apna khud ka account delete nahi kar sakte");
  if (target.permissions?.boss && actor.role !== "admin") throw new TaskError(403, "Admin user ko sirf admin delete kar sakta hai");
  await col.deleteOne({ _id });
  return { message: "User delete ho gaya" };
}
