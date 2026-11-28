import { NextResponse } from "next/server";
import UrgentTask from "@/models/UrgentTask";
import { TaskError, getActor } from "@/lib/tasks/permissions";

// Auth: identity from the session cookie (getActor, which also connects the DB).
// Admin sees everything and creates tasks; anyone else only gets their own due tasks.
function authError(err: any) {
  return err instanceof TaskError ? NextResponse.json({ error: err.message }, { status: err.status }) : null;
}

const ESCALATE_AFTER_MS = 60 * 60 * 1000; // 1 hour

// Escalation is computed on read, not by a background job - there's no
// always-on process in this Next.js/Vercel app to run a periodic timer in,
// and a task's "pending for over an hour" state is fully derivable from
// createdAt + status at query time anyway.
function withEscalation(doc: any) {
  const pendingMs = Date.now() - new Date(doc.createdAt).getTime();
  return {
    ...doc,
    escalated: doc.status !== "done" && pendingMs >= ESCALATE_AFTER_MS,
    pendingMinutes: Math.floor(pendingMs / 60000),
  };
}

// GET /api/urgent-tasks?username=X - tasks currently DUE for the LOGGED-IN user
// (pending, or snoozed with snoozeUntil already passed) - polled by the global
// popup every ~25s (see components/UrgentTaskPopup.tsx). The param only picks
// this mode; the session user is always used, never X.
// GET /api/urgent-tasks (no username, admin only) - every open (pending/snoozed)
// task system-wide, for the owner dashboard. Non-admins get their own list.
export async function GET(req: Request) {
  try {
    const actor = await getActor(req);
    const { searchParams } = new URL(req.url);
    const ownOnly = !!searchParams.get("username") || actor.role !== "admin";
    const username = ownOnly ? actor.username : null;

    if (username) {
      const tasks = await UrgentTask.find({
        assignedTo: username,
        $or: [{ status: "pending" }, { status: "snoozed", snoozeUntil: { $lte: new Date() } }],
      })
        .sort({ createdAt: 1 })
        .lean();
      return NextResponse.json(tasks.map(withEscalation));
    }

    const tasks = await UrgentTask.find({ status: { $in: ["pending", "snoozed"] } })
      .sort({ createdAt: 1 })
      .lean();
    return NextResponse.json(tasks.map(withEscalation));
  } catch (error: any) {
    const auth = authError(error);
    if (auth) return auth;
    console.error("GET urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch urgent tasks" }, { status: 500 });
  }
}

// POST /api/urgent-tasks - owner (admin) creates a new urgent task.
// assignedBy is always the session user; a body value is ignored.
export async function POST(req: Request) {
  try {
    const actor = await getActor(req);
    if (actor.role !== "admin") {
      return NextResponse.json({ error: "Urgent task sirf admin bana sakta hai" }, { status: 403 });
    }
    const { description, assignedTo } = await req.json();
    const assignedBy = actor.username;

    if (!description?.trim() || !assignedTo) {
      return NextResponse.json({ error: "description and assignedTo are required" }, { status: 400 });
    }

    const task = await UrgentTask.create({ description: description.trim(), assignedTo, assignedBy });
    return NextResponse.json(withEscalation(task.toObject()), { status: 201 });
  } catch (error: any) {
    const auth = authError(error);
    if (auth) return auth;
    console.error("POST urgent-tasks error:", error);
    return NextResponse.json({ error: error.message || "Failed to create urgent task" }, { status: 500 });
  }
}
