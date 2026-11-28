import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { previewTemplate } from "@/lib/tasks/templateService";

// POST /api/templates/preview { recurrence, dueTime } - next 5 dates (Sunday/holiday shift applied), nothing saved
export async function POST(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return previewTemplate(actor, await readBody(req));
  });
}
