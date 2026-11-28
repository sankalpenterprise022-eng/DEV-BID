import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { createHoliday, listHolidays } from "@/lib/tasks/orgService";

// GET /api/holidays?year=2026 - any logged-in user
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return listHolidays(actor, new URL(req.url).searchParams.get("year"));
  });
}

// POST /api/holidays { date: "YYYY-MM-DD", name } - admin
export async function POST(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return createHoliday(actor, await readBody(req));
  }, 201);
}
