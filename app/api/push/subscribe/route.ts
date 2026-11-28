import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { subscribePush, unsubscribePush } from "@/lib/notify/notifyService";

// POST /api/push/subscribe - save this browser's PushSubscription for the logged-in user
export async function POST(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return subscribePush(actor, await readBody(req), req.headers.get("user-agent") || "");
  });
}

// DELETE /api/push/subscribe - { endpoint } remove (logout / notifications off)
export async function DELETE(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return unsubscribePush(actor, await readBody(req));
  });
}
