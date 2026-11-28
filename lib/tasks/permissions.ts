import mongoose from "mongoose";
import dbConnect from "@/lib/dbConnect";
import type { TaskRole } from "./types";
import { SessionConfigError, SessionData, isHardcodedAdmin, readSessionToken, verifySession } from "@/lib/auth/session";

export class TaskError extends Error {
  status: number;
  extra?: Record<string, any>;
  constructor(status: number, message: string, extra?: Record<string, any>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const FULL_PERMISSIONS = { boss: true, users: true, taskManager: true };

export function getTaskRole(user: { permissions?: Record<string, boolean> } | null | undefined): TaskRole {
  if (user?.permissions?.boss) return "admin";
  if (user?.permissions?.taskManager) return "manager";
  return "staff";
}

export interface TaskActor {
  username: string;
  role: TaskRole;
  /** Manager only: usernames whose managerUsername is this manager. Empty = no team set. */
  team: string[];
  /** Raw permission flags from the DB (full set for hardcoded admins). */
  permissions: Record<string, boolean>;
}

export function usersCollection() {
  const db = mongoose.connection.db;
  if (!db) throw new TaskError(500, "Database connection not initialized");
  return db.collection("users");
}

/**
 * Identify the acting user from the signed httpOnly session cookie ONLY
 * (set by /api/login). Header / query / body usernames are ignored.
 * Permissions are re-read from the DB on every request, so a permission
 * change or user delete takes effect immediately.
 */
export async function getActor(req: Request): Promise<TaskActor> {
  let session: SessionData | null;
  try {
    session = await verifySession(readSessionToken(req));
  } catch (e) {
    if (e instanceof SessionConfigError) throw new TaskError(500, e.message);
    throw e;
  }
  if (!session) throw new TaskError(401, "Login karo pehle (session nahi mila ya expire ho gaya)");
  const { username } = session;
  await dbConnect();

  let role: TaskRole;
  let permissions: Record<string, boolean>;
  // Only a fallback-password login is a hardcoded admin; a DB user named "Admin"
  // gets exactly their DB permissions (the name alone grants nothing).
  if (session.fallbackAdmin && isHardcodedAdmin(username)) {
    // Session for a hardcoded admin stops working once the fallback login is disabled.
    if (!process.env.ADMIN_FALLBACK_PASSWORD) throw new TaskError(401, "Admin login band hai, dobara login karo");
    role = "admin";
    permissions = { ...FULL_PERMISSIONS };
  } else {
    const user = await usersCollection().findOne({ username }, { projection: { permissions: 1 } });
    if (!user) throw new TaskError(401, "User nahi mila, dobara login karo");
    role = getTaskRole(user as any);
    permissions = { ...((user as any).permissions || {}) };
  }

  let team: string[] = [];
  if (role === "manager") {
    const members = await usersCollection()
      .find({ managerUsername: username }, { projection: { username: 1 } })
      .toArray();
    team = members.map((m: any) => m.username);
  }
  return { username, role, team, permissions };
}

/** Users page access: admin or the `users` permission. */
export const canManageUsers = (a: TaskActor) => a.role === "admin" || a.permissions.users === true;

export const isManagerOrAdmin = (a: TaskActor) => a.role === "admin" || a.role === "manager";

/** Manager with no team members set sees/assigns everything (admin minus delete). */
export const managerSeesAll = (a: TaskActor) => a.role === "manager" && a.team.length === 0;

/** Mongo filter limiting tasks to the ones this actor may see (spec 2.2). */
export function visibilityFilter(a: TaskActor): Record<string, any> {
  if (a.role === "admin" || managerSeesAll(a)) return {};
  const people = a.role === "manager" ? [a.username, ...a.team] : [a.username];
  return {
    $or: [
      { assignee: { $in: people } },
      { assignedBy: { $in: people } },
      { watchers: a.username },
    ],
  };
}

export function canViewTask(a: TaskActor, t: { assignee: string; assignedBy: string; watchers?: string[] }): boolean {
  if (a.role === "admin" || managerSeesAll(a)) return true;
  const people = a.role === "manager" ? [a.username, ...a.team] : [a.username];
  return people.includes(t.assignee) || people.includes(t.assignedBy) || (t.watchers || []).includes(a.username);
}

/** May the actor assign (or reassign) work to `target`? */
export function canAssignTo(a: TaskActor, target: string): boolean {
  if (a.role === "admin") return true;
  if (a.role === "manager") return target === a.username || managerSeesAll(a) || a.team.includes(target);
  return target === a.username;
}
