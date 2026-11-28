import { getActor } from "@/lib/tasks/permissions";
import { readBody, respond } from "@/lib/tasks/http";
import { createUser, getUserByName, listUsers } from "@/lib/users/userService";

// GET /api/users            - all users (admin / `users` permission), never passwords
// GET /api/users?username=X - one user (yourself, or anyone if you manage users)
export async function GET(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    const username = new URL(req.url).searchParams.get("username");
    return username ? getUserByName(actor, username) : listUsers(actor);
  });
}

// POST /api/users - create (password is bcrypt-hashed)
export async function POST(req: Request) {
  return respond(async () => {
    const actor = await getActor(req);
    return createUser(actor, await readBody(req));
  }, 201);
}
