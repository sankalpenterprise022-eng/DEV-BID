"use client";

// Browser side of Web Push: service worker registration + subscribe/unsubscribe.

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (e) {
    console.warn("Service worker register fail", e);
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) || null;
}

export async function getPushState(): Promise<PushState> {
  // iPhone/iPad: Web Push works only from the Home Screen app (iOS 16.4+).
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function saveOnServer(sub: PushSubscription) {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Subscription save nahi hua");
}

/** Ask permission (must be called from a tap), subscribe, save on server. Throws a Hinglish message on failure. */
export async function enablePush(vapidPublicKey: string): Promise<void> {
  if (isIOS() && !isStandalone()) throw new Error("iPhone par pehle Share → 'Add to Home Screen' karo, phir app se notifications ON karo");
  if (!pushSupported()) throw new Error("Is browser mein notifications support nahi hain (Chrome / Edge / Safari app use karo)");
  if (!vapidPublicKey) throw new Error("Push abhi server par set nahi hai (VAPID keys missing)");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission nahi mili - browser settings mein Allow karo");
  const reg = (await registerSW()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Server keys changed -> old subscription is useless.
  const want = b64ToBytes(vapidPublicKey);
  const have = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await saveOnServer(sub);
}

/** Permission already granted: make sure this device's subscription is stored for the current user (silent). */
export async function syncPush(vapidPublicKey: string): Promise<void> {
  if (!vapidPublicKey || !pushSupported() || Notification.permission !== "granted") return;
  try {
    await enablePush(vapidPublicKey);
  } catch {
    /* silent */
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
