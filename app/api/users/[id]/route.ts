import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { deleteUser, updateUser } from "@/lib/users/userService";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/users/[id] - password (blank = unchanged), permissions, managerUsername
export async function PUT(req: Request, { params }: Ctx) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return updateUser(actor, id, await readBody(req));
  });
}

// DELETE /api/users/[id]
export async function DELETE(req: Request, { params }: Ctx) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return deleteUser(actor, id);
  });
}
