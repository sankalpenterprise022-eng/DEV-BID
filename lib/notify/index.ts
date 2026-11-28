import dbConnect from "@/lib/dbConnect";
import { PushPayload, sendPush } from "./push";

// One entry point for every alert: notify(username, {title, body, url}).
// Alerts are Web Push notifications only (phone / computer pop-ups). Never throws.

export interface NotifyResult {
  push: { sent: number; failed: number };
}

export async function notify(username: string, payload: PushPayload): Promise<NotifyResult> {
  const result: NotifyResult = { push: { sent: 0, failed: 0 } };
  if (!username) return result;
  try {
    await dbConnect();
    result.push = await sendPush(username, payload);
  } catch (e) {
    console.error(`notify(${username}) fail:`, e);
  }
  return result;
}

/** Same alert to several people (deduped, blanks dropped). */
export async function notifyMany(usernames: (string | null | undefined)[], payload: PushPayload) {
  const list = [...new Set(usernames.filter((u): u is string => !!u))];
  await Promise.all(list.map((u) => notify(u, payload)));
  return list;
}
