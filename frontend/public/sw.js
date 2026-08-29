// This project does not use a service worker / PWA offline caching — there
// is no `serviceWorker.register()` call anywhere in frontend/src. The
// repeated `GET /sw.js -> 404` requests in the logs come from browsers
// that registered a service worker from some earlier version of this site
// (or a different app on the same origin during testing); those browsers
// periodically re-fetch their registered script to check for updates.
//
// Per spec, a browser that gets a 404 for its registered SW script will
// eventually unregister it on its own — but that can take a while and
// keeps generating noisy 404s in the meantime. Serving this instead (a
// real, minimal service worker whose only job is to immediately unregister
// itself and clear any caches it might have created) clears it out on the
// very next visit rather than waiting on the browser's own retry/backoff
// schedule. This is not a fake success response — it's a real service
// worker that runs, does its one job (clean up), and removes itself.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Remove any caches a previous version of this site's service worker
      // may have created.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      // Unregister this service worker so it stops being installed at all
      // for future visits.
      await self.registration.unregister();
      // Take control of any open tabs so they stop routing through this
      // worker immediately, rather than waiting for a reload.
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => client.navigate(client.url));
    })(),
  );
});
