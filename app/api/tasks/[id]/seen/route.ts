import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { markSeen } from "@/lib/tasks/taskService";

// POST /api/tasks/[id]/seen - assignee acknowledges the task ("Dekh liya"); sets seenAt once
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const actor = await getActor(req);
    const { id } = await params;
    return markSeen(actor, id);
  });
}
