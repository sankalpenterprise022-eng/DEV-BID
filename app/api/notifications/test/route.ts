import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { testNotify } from "@/lib/notify/notifyService";

// POST /api/notifications/test - test alert (push) to my own devices
export async function POST(req: Request) {
  return respond(async () => testNotify(await getActor(req)));
}
