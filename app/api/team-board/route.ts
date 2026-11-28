import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { teamBoard } from "@/lib/tasks/reportService";

// GET /api/team-board - live view of who is working on what (manager: own team, admin: everybody)
export async function GET(req: Request) {
  return respond(async () => teamBoard(await getActor(req)));
}
