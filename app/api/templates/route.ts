import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { createTemplate, listTemplates } from "@/lib/tasks/templateService";

// GET /api/templates - fixed (recurring) task templates (manager/admin)
export async function GET(req: Request) {
  return respond(async () => listTemplates(await getActor(req)));
}

// POST /api/templates - create; also generates today's due occurrences right away
export async function POST(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return createTemplate(actor, await readBody(req));
  }, 201);
}
