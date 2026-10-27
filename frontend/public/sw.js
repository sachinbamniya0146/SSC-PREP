// SSC Prep Hub service worker v4 — PUSH NOTIFICATIONS ONLY.
//
// The old offline cache (pages / API / packs) was removed: this worker has NO fetch handler, so every request goes
// straight to the network exactly as without a worker. On activation it deletes every cache the older versions
// created, so devices that still hold the old offline copy are cleaned automatically on their next visit.

self.addEventListener("install", () => {
  // replace the previous (caching) worker immediately instead of waiting for all tabs to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* Cache Storage unavailable */
      }
      await self.clients.claim();
    })(),
  );
});

// ------------------------------------------------------------------ Web Push (admin broadcast, backend/src/push)

self.addEventListener("push", (event) => {
  let data = { title: "SSC Prep Hub", body: "You have a new update." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/dashboard" },
    tag: data.tag || undefined,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => c.url.includes(targetUrl));
      if (existing) {
        existing.focus();
      } else {
        self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
