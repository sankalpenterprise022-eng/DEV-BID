import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { deleteHoliday } from "@/lib/tasks/orgService";

// DELETE /api/holidays/[id] - admin
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return deleteHoliday(actor, id);
  });
}
