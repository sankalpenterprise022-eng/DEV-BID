import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { monthlyReport } from "@/lib/tasks/reportService";

// GET /api/reports/monthly?month=YYYY-MM - per user + per department numbers (admin only)
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return monthlyReport(actor, new URL(req.url).searchParams.get("month"));
  });
}
