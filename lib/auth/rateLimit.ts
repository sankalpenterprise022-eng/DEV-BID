import type { Db } from "mongodb";

// Mongo-based (works across serverless instances, unlike an in-memory map).
// One doc per FAILED login attempt, auto-removed by a TTL index after the window.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const COLLECTION = "login_attempts";

let indexReady: Promise<unknown> | null = null;
function ensureIndex(db: Db) {
  if (!indexReady) {
    indexReady = Promise.all([
      db.collection(COLLECTION).createIndex({ createdAt: 1 }, { expireAfterSeconds: WINDOW_MS / 1000 }),
      db.collection(COLLECTION).createIndex({ key: 1, createdAt: 1 }),
    ]).catch((e) => { indexReady = null; throw e; });
  }
  return indexReady;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const attemptKey = (username: string, ip: string) => `${username.trim().toLowerCase()}|${ip}`;

/** Minutes until the user may try again, or 0 if not blocked. */
export async function loginBlockedFor(db: Db, key: string): Promise<number> {
  await ensureIndex(db);
  const since = new Date(Date.now() - WINDOW_MS);
  const fails = await db.collection(COLLECTION)
    .find({ key, createdAt: { $gt: since } }, { projection: { createdAt: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
  if (fails.length < MAX_FAILS) return 0;
  // Unblocked when the oldest counted attempt leaves the window.
  const freeAt = new Date(fails[fails.length - MAX_FAILS].createdAt).getTime() + WINDOW_MS;
  return Math.max(1, Math.ceil((freeAt - Date.now()) / 60000));
}

export async function recordFailedLogin(db: Db, key: string) {
  await ensureIndex(db);
  await db.collection(COLLECTION).insertOne({ key, createdAt: new Date() });
}

export async function clearFailedLogins(db: Db, key: string) {
  await db.collection(COLLECTION).deleteMany({ key });
}
