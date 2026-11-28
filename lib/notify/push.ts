import { sendNotification } from "web-push";
import PushSubscription from "@/models/PushSubscription";

// Web Push (VAPID). Keys come from env (generate with `npm run gen:vapid`).
// Missing keys = push disabled; nothing throws.

export interface PushPayload {
  title: string;
  body: string;
  /** Opened on notification click, e.g. /dashboard/tasks?task=<id> */
  url?: string;
  /** Same tag replaces the older notification instead of stacking. */
  tag?: string;
  /** Urgent: stays on screen until tapped. */
  urgent?: boolean;
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function vapidDetails() {
  let subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!/^(mailto:|https:)/.test(subject)) subject = `mailto:${subject}`;
  return { subject, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! };
}

/** Push to every device of `username`. Dead subscriptions (404/410) are deleted. Never throws. */
export async function sendPush(username: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (!pushConfigured() || !username) return out;
  let subs: any[] = [];
  try {
    subs = await PushSubscription.find({ username }).lean();
  } catch (e) {
    console.error("Push: subscriptions load fail", e);
    return out;
  }
  const body = JSON.stringify({ ...payload, url: payload.url || "/dashboard/tasks" });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } },
          body,
          { vapidDetails: vapidDetails(), TTL: 24 * 60 * 60, urgency: payload.urgent ? "high" : "normal", timeout: 10_000 }
        );
        out.sent++;
        PushSubscription.updateOne({ _id: s._id }, { $set: { lastOkAt: new Date() } }).catch(() => {});
      } catch (e: any) {
        out.failed++;
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: s._id }).catch(() => {});
        } else {
          console.error(`Push fail (${username}):`, e?.statusCode || "", e?.body || e?.message || e);
        }
      }
    })
  );
  return out;
}
