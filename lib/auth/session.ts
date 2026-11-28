import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";

// Signed session = HS256 JWT in an httpOnly cookie. The only source of
// identity on the server (see getActor in lib/tasks/permissions.ts).
// localStorage "oms_user" is kept for UI display only.

export const SESSION_COOKIE = "oms_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

/** Same list as everywhere else: these may not exist in the users collection. */
export const HARDCODED_ADMINS = ["admin", "chintan", "hitesh"];
export const isHardcodedAdmin = (u: string) => HARDCODED_ADMINS.includes(u.trim().toLowerCase());

export class SessionConfigError extends Error {}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32) {
    throw new SessionConfigError("SESSION_SECRET set nahi hai ya 32 characters se chhota hai (.env.local check karo)");
  }
  return new TextEncoder().encode(s);
}

export interface SessionData {
  username: string;
  /** true only when logged in with ADMIN_FALLBACK_PASSWORD (hardcoded admin, maybe not in the users collection).
   *  A DB user whose name happens to be "Admin" etc. is a normal DB user (fallbackAdmin false). */
  fallbackAdmin: boolean;
}

export async function signSession(username: string, opts: { fallbackAdmin?: boolean } = {}): Promise<string> {
  return new SignJWT(opts.fallbackAdmin ? { fa: true } : {})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secretKey());
}

/** Session from a valid token, or null (missing / expired / tampered). */
export async function verifySession(token: string | null | undefined): Promise<SessionData | null> {
  if (!token) return null;
  const key = secretKey(); // config error must surface, not look like "logged out"
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { username: payload.sub, fallbackAdmin: payload.fa === true };
  } catch {
    return null;
  }
}

/** Read the session cookie from a plain Request (route handlers get Request, not NextRequest). */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Secure only when the request came over HTTPS (Vercel / reverse proxy). On a
 * plain-http LAN server (http://dev-server:3000) a Secure cookie would be
 * dropped by the browser and nobody could log in.
 */
function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";
  return new URL(req.url).protocol === "https:";
}

export function setSessionCookie(res: NextResponse, req: Request, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export function clearSessionCookie(res: NextResponse, req: Request) {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
