import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { ensureRecurringTasks } from "@/lib/tasks/templateService";

// POST /api/tasks/recurring - lazy backup for the cron: generate today's fixed tasks
// (throttled to once per 10 min across all users). Called when /dashboard/tasks opens.
export async function POST(req: Request) {
  return respond(async () => ensureRecurringTasks(await getActor(req)));
}
