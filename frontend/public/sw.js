// SSC Prep Hub service worker.
//
// Two jobs:
//  1. Make the site installable / feel like a native app (basic offline
//     shell caching for the icons + manifest, so a flaky connection on a
//     student's phone doesn't show a browser error page).
//  2. Receive Web Push notifications sent by the admin broadcast tool
//     (see backend/src/push) and show them as real OS-level notifications,
//     even when the app/tab is closed.
//
// NOTE: an earlier version of this file was a stub that immediately
// unregistered itself (see git history) — that's why it was safe to
// overwrite here, but it also means every already-installed client will
// need one visit to pick up this new version before push will work for
// them.

const CACHE_NAME = "ssc-prep-shell-v1";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-192-maskable.png",
  "/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Cache-first for the small static app-shell assets only. Everything else
// (API calls, pages) goes straight to the network — we are not trying to
// build a full offline mode here, just avoid a broken icon/manifest.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (!APP_SHELL.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});

// ---- Push notifications ----------------------------------------------

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
