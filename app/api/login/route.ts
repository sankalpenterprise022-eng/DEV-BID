import clientPromise from "@/lib/mongodb";
import { NextResponse } from "next/server";

const FULL_PERMISSIONS = { boss: true, users: true, taskManager: true };

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();
    const usernameLower = username?.toLowerCase();

    // Hardcoded fallback/static admin login. Password comes from env; if the env
    // var is empty/unset this path is disabled (otherwise a missing password
    // would compare undefined === undefined).
    const fallbackPassword = process.env.ADMIN_FALLBACK_PASSWORD;
    if (
      fallbackPassword &&
      typeof password === "string" &&
      (usernameLower === "admin" || usernameLower === "chintan" || usernameLower === "hitesh") &&
      password === fallbackPassword
    ) {
      return NextResponse.json({
        success: true,
        username: username,
        permissions: FULL_PERMISSIONS,
      });
    }

    const client = await clientPromise;
    // Same DB as everything else: the default DB in MONGODB_URI.
    const db = client.db();

    // Search for the user in the 'users' collection
    const user = await db.collection("users").findOne({ username, password });

    if (!user) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      username: user.username,
      permissions: user.permissions,
    });
  } catch (error: any) {
    console.error("Database connection error details:", error);
    return NextResponse.json({ error: "Database connection failed", details: error.message }, { status: 500 });
  }
}
