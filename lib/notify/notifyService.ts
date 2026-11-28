import TaskSettings from "@/models/TaskSettings";
import PushSubscription from "@/models/PushSubscription";
import { TaskActor, TaskError } from "@/lib/tasks/permissions";
import { pushConfigured, sendPush, vapidPublicKey } from "./push";
import { getTaskSettings } from "./workHours";
import { ensureNotifyIndexes } from "./taskAlerts";

// Alerts page logic (routes stay thin: getActor() -> one function here).

// The server POSTs to a subscription endpoint, so only real browser push services are accepted.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];

function checkEndpoint(raw: any): string {
  const endpoint = typeof raw === "string" ? raw.trim() : "";
  let url: URL | null = null;
  try { url = new URL(endpoint); } catch { /* invalid */ }
  if (!url || url.protocol !== "https:" || endpoint.length > 1000 || !PUSH_HOSTS.some((rx) => rx.test(url!.hostname))) {
    throw new TaskError(400, "Push subscription sahi nahi hai");
  }
  return endpoint;
}

/** GET /api/notifications/settings */
export async function getNotifySettings(actor: TaskActor) {
  const [work, devices] = await Promise.all([getTaskSettings(), PushSubscription.countDocuments({ username: actor.username })]);
  return {
    pushConfigured: pushConfigured(),
    vapidPublicKey: vapidPublicKey(),
    devices,
    isAdmin: actor.role === "admin",
    work,
  };
}

const HOUR = (v: any, label: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 24) throw new TaskError(400, `${label} 0 se 24 ke beech ghante mein do`);
  return n;
};

/** PATCH /api/notifications/settings - admin: `work` (hours + working days). */
export async function updateNotifySettings(actor: TaskActor, body: any) {
  if (body?.work !== undefined) {
    if (actor.role !== "admin") throw new TaskError(403, "Work hours sirf admin badal sakta hai");
    const w = body.work || {};
    const set: Record<string, any> = {};
    if (w.workStartHour !== undefined) set.workStartHour = HOUR(w.workStartHour, "Start time");
    if (w.workEndHour !== undefined) set.workEndHour = HOUR(w.workEndHour, "End time");
    const cur = await getTaskSettings();
    if ((set.workStartHour ?? cur.workStartHour) >= (set.workEndHour ?? cur.workEndHour)) {
      throw new TaskError(400, "Work end time start time ke baad hona chahiye");
    }
    if (w.workingDays !== undefined) {
      const days = Array.isArray(w.workingDays) ? [...new Set<number>(w.workingDays.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort() : [];
      if (!days.length) throw new TaskError(400, "Kam se kam ek working day chuno");
      set.workingDays = days;
    }
    if (Object.keys(set).length) await TaskSettings.updateOne({ _id: "default" }, { $set: set }, { upsert: true });
  }
  return getNotifySettings(actor);
}

/** POST /api/push/subscribe - this browser now gets alerts for the logged-in user. */
export async function subscribePush(actor: TaskActor, body: any, userAgent: string) {
  if (!pushConfigured()) throw new TaskError(400, "Push abhi server par set nahi hai (VAPID keys missing)");
  const endpoint = checkEndpoint(body?.endpoint);
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw new TaskError(400, "Push subscription sahi nahi hai");
  await ensureNotifyIndexes();
  // Same device, different login -> the device moves to the new user.
  await PushSubscription.updateOne(
    { endpoint },
    { $set: { username: actor.username, keys: { p256dh, auth }, userAgent: userAgent.slice(0, 300) } },
    { upsert: true }
  );
  return { ok: true, devices: await PushSubscription.countDocuments({ username: actor.username }) };
}

/** DELETE /api/push/subscribe - on logout / "notifications off". */
export async function unsubscribePush(actor: TaskActor, body: any) {
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (endpoint) await PushSubscription.deleteOne({ endpoint, username: actor.username });
  return { ok: true };
}

/** POST /api/notifications/test - send a test alert to my own devices. */
export async function testNotify(actor: TaskActor) {
  if (!pushConfigured()) throw new TaskError(400, "Push abhi server par set nahi hai (VAPID keys missing)");
  const r = await sendPush(actor.username, {
    title: "🔔 Test notification",
    body: `Namaste ${actor.username}, alerts chal rahe hain ✅`,
    url: "/dashboard/tasks",
    tag: "test",
  });
  if (!r.sent && !r.failed) throw new TaskError(400, "Koi device subscribe nahi hai - pehle 'Notifications ON karo' dabao");
  if (!r.sent) throw new TaskError(502, "Push nahi gaya - notifications dobara ON karo");
  return { ok: true, message: `Test alert ${r.sent} device par bheja` };
}
