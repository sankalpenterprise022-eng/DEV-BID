"use client";

// Browser side of the session. Auth itself is the httpOnly "oms_session"
// cookie (sent automatically on same-origin fetch); localStorage "oms_user"
// only caches { username, permissions } for UI display.

import { disablePush } from "@/lib/notify/client";

export const SESSION_KEY = "oms_user";

export interface MeDTO {
  username: string;
  role: "admin" | "manager" | "staff";
  permissions: Record<string, boolean>;
}

/** Ask the server who we are. null = not logged in (401); throws on network/server errors. */
export async function fetchMe(): Promise<MeDTO | null> {
  const res = await fetch("/api/me", { cache: "no-store" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me ${res.status}`);
  return res.json();
}

export function saveDisplayUser(me: { username: string; permissions?: Record<string, boolean> }) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username: me.username, permissions: me.permissions || {} }));
}

let redirecting = false;
/** Cookie missing/expired: drop the display cache and go to login (once, even if many requests 401 together). */
export function handleSessionExpired() {
  localStorage.removeItem(SESSION_KEY);
  if (redirecting || window.location.pathname === "/login") return;
  redirecting = true;
  window.location.href = "/login";
}

export async function logout() {
  // Shared device: stop this browser getting the old user's pushes (needs the cookie, so before /api/logout).
  await disablePush().catch(() => {});
  localStorage.removeItem(SESSION_KEY);
  await fetch("/api/logout", { method: "POST" }).catch(() => {});
}
