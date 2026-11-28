import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { updateDepartment } from "@/lib/tasks/orgService";

// PATCH /api/departments/[id] { name?, active? } - admin
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return updateDepartment(actor, id, await readBody(req));
  });
}
