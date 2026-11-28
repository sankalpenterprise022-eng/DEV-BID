import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { deleteTemplate, updateTemplate } from "@/lib/tasks/templateService";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/templates/[id] - full edit, or { active } toggle; send expectedUpdatedAt (409 on conflict)
export async function PATCH(req: Request, { params }: Ctx) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return updateTemplate(actor, id, await readBody(req));
  });
}

// DELETE /api/templates/[id] - template only; already generated tasks stay
export async function DELETE(req: Request, { params }: Ctx) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return deleteTemplate(actor, id);
  });
}
