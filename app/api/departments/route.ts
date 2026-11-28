import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { createDepartment, listDepartments } from "@/lib/tasks/orgService";

// GET /api/departments - all departments + member usernames (any logged-in user; seeds defaults when empty)
export async function GET(req: Request) {
  return respond(async () => listDepartments(await getActor(req)));
}

// POST /api/departments { name } - admin
export async function POST(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return createDepartment(actor, await readBody(req));
  }, 201);
}
