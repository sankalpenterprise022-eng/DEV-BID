import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

// POST /api/logout - drops the session cookie (httpOnly, so JS can't).
export async function POST(req: Request) {
  const res = NextResponse.json({ success: true });
  clearSessionCookie(res, req);
  return res;
}
