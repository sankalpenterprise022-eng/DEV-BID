// Dev Task OMS service worker: Web Push notifications only (no offline cache).
// Payload (JSON from lib/notify/push.ts): { title, body, url, tag, urgent }

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const urgent = !!d.urgent;
  event.waitUntil(
    self.registration.showNotification(d.title || "Dev Task OMS", {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      requireInteraction: urgent, // urgent stays until tapped
      vibrate: urgent ? [300, 100, 300, 100, 300] : [150],
      data: { url: d.url || "/dashboard/tasks" },
    })
  );
});

// Tap -> open /dashboard/tasks?task=<id> (reuse an open app tab if there is one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/dashboard/tasks", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const win = wins.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) {
        await win.focus();
        try {
          if (win.navigate) { await win.navigate(url); return; }
        } catch {
          /* not controlled by this worker - fall back to a message */
        }
        win.postMessage({ type: "OPEN_URL", url });
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});
