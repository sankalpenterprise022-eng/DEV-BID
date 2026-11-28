import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { getNotifySettings, updateNotifySettings } from "@/lib/notify/notifyService";

// GET /api/notifications/settings - push status, my device count, work hours
export async function GET(req: Request) {
  return respond(async () => getNotifySettings(await getActor(req)));
}

// PATCH /api/notifications/settings - { work } (admin: work hours + working days)
export async function PATCH(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return updateNotifySettings(actor, await readBody(req));
  });
}
