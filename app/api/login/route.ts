import clientPromise from "@/lib/mongodb";
import { NextResponse } from "next/server";
import { burnCompareTime, hashPassword, verifyPassword } from "@/lib/auth/password";
import { SessionConfigError, isHardcodedAdmin, setSessionCookie, signSession } from "@/lib/auth/session";
import { attemptKey, clearFailedLogins, clientIp, loginBlockedFor, recordFailedLogin } from "@/lib/auth/rateLimit";

const FULL_PERMISSIONS = { boss: true, users: true, taskManager: true };
const BAD_LOGIN = "Username ya password galat hai";

/** Issue the session cookie; body is only for localStorage UI display. */
async function loggedIn(req: Request, username: string, permissions: Record<string, boolean>, fallbackAdmin = false) {
  const res = NextResponse.json({ success: true, username, permissions });
  setSessionCookie(res, req, await signSession(username, { fallbackAdmin }));
  return res;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) {
      return NextResponse.json({ error: "Username aur password dono chahiye" }, { status: 400 });
    }

    const client = await clientPromise;
    // Same DB as everything else: the default DB in MONGODB_URI.
    const db = client.db();

    const key = attemptKey(username, clientIp(request));
    const waitMin = await loginBlockedFor(db, key);
    if (waitMin > 0) {
      return NextResponse.json(
        { error: `Bahut zyada galat try ho gaye, ${waitMin} min baad dobara try karo` },
        { status: 429 }
      );
    }

    // Hardcoded super-admins. Password comes from env; if the env var is
    // empty/unset this path is disabled. Username is stored lowercase in the
    // session so "Admin" and "admin" are the same actor.
    if (isHardcodedAdmin(username)) {
      const fallbackPassword = process.env.ADMIN_FALLBACK_PASSWORD;
      if (fallbackPassword && password === fallbackPassword) {
        await clearFailedLogins(db, key);
        return loggedIn(request, username.toLowerCase(), FULL_PERMISSIONS, true);
      }
      // A real DB user with this name (if any) still gets a chance below.
    }

    const users = db.collection("users");
    const user = await users.findOne({ username });
    if (!user) {
      await burnCompareTime(password);
      await recordFailedLogin(db, key);
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    const check = await verifyPassword(password, user.password);
    if (!check.ok) {
      await recordFailedLogin(db, key);
      return NextResponse.json({ error: BAD_LOGIN }, { status: 401 });
    }

    // Not yet migrated by scripts/hash-passwords.mjs -> hash it now. Filter on
    // the old value so a concurrent password change is never overwritten.
    if (check.needsRehash) {
      await users.updateOne({ _id: user._id, password: user.password }, { $set: { password: await hashPassword(password) } });
    }

    await clearFailedLogins(db, key);
    return loggedIn(request, user.username, user.permissions || {});
  } catch (error: any) {
    if (error instanceof SessionConfigError) {
      console.error(error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Login error:", error);
    return NextResponse.json({ error: "Login fail ho gaya (server/database error)" }, { status: 500 });
  }
}
