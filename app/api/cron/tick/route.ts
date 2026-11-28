import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { respond } from "@/lib/tasks/http";
import { TaskError } from "@/lib/tasks/permissions";
import { runTick } from "@/lib/notify/reminderService";

// Reminders cron - call every 5 minutes.
//   POST /api/cron/tick   header  x-cron-secret: <CRON_SECRET>   (scripts/cron-local.mjs, any external cron)
//   GET  /api/cron/tick   header  Authorization: Bearer <CRON_SECRET>   (Vercel Cron format)
// No session cookie: the shared secret is the only auth.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function checkSecret(given: string | null) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new TaskError(500, "CRON_SECRET server par set nahi hai");
  if (!given || !same(given, secret)) throw new TaskError(401, "Cron secret galat hai");
}

export async function POST(req: Request) {
  return respond(async () => {
    checkSecret(req.headers.get("x-cron-secret"));
    return runTick();
  });
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return NextResponse.json({ error: "Cron secret galat hai" }, { status: 401 });
  return respond(async () => {
    checkSecret(auth.slice(7));
    return runTick();
  });
}
