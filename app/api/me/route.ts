import { getActor } from "@/lib/tasks/permissions";
import { respond } from "@/lib/tasks/http";
import { me } from "@/lib/users/userService";

// GET /api/me - current user from the session cookie (401 if not logged in).
// The client uses it to validate the session and refresh display permissions.
export async function GET(req: Request) {
  return respond(async () => me(await getActor(req)));
}
