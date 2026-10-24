// SSC Prep Hub service worker v2: offline-capable app.
//
//  1. App shell + pages: visited pages and all their JS/CSS are cached, so the app opens with no internet.
//  2. API reads (GET): network-first, falling back to the last good copy (dashboard, results, AI solutions...).
//  3. Offline fallback page for anything that was never cached.
//  4. Web Push notifications (admin broadcast tool, see backend/src/push).
//
// Writes (POST/PUT/DELETE) are never touched here: the app queues test submits itself (lib/offline-submit.ts).

const VERSION = "v2";
const SHELL_CACHE = `ssc-shell-${VERSION}`; // precached icons / offline page
const STATIC_CACHE = `ssc-static-${VERSION}`; // /_next/static (hashed, immutable)
const PAGE_CACHE = `ssc-pages-${VERSION}`; // HTML + RSC payloads of visited pages
const API_CACHE = `ssc-api-${VERSION}`; // GET /api/v1/*
const MEDIA_CACHE = `ssc-media-${VERSION}`; // images, fonts
const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, PAGE_CACHE, API_CACHE, MEDIA_CACHE];

const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-192-maskable.png",
  "/icon-512-maskable.png",
  "/logo.png",
];

const API_MAX_ENTRIES = 250;
const PAGE_MAX_ENTRIES = 80;
const NETWORK_TIMEOUT_MS = 4000;

// never cache these API areas (auth, admin tools, live chat, payments, push)
const API_DENY = /\/api\/v1\/(auth|admin|chat|support-chat|push|telegram|payments\/(order|webhook|verify)|referral\/withdraw)/;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => undefined))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// ------------------------------------------------------------------ helpers

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function networkFirst(request, cacheName, maxEntries, { fallbackUrl, timeout = NETWORK_TIMEOUT_MS, ignoreSearch = false } = {}) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(request), timeout);
    if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
      cache.put(request, res.clone()).then(() => trim(cacheName, maxEntries)).catch(() => undefined);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch });
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await caches.match(fallbackUrl);
      if (fb) return fb;
    }
    // API: a clean JSON error the app can show, instead of a thrown network failure
    if (request.url.includes("/api/v1/")) {
      return new Response(JSON.stringify({ message: "Offline: ye data abhi saved nahi hai.", offline: true }), {
        status: 503,
        headers: { "Content-Type": "application/json", "X-Offline": "1" },
      });
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone()).catch(() => undefined);
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone()).catch(() => undefined);
      return res;
    })
    .catch(() => undefined);
  return hit || (await refresh) || Response.error();
}

// ------------------------------------------------------------------ fetch routing

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API reads, any origin (same-origin /api/v1 or the :4000 LAN API)
  if (url.pathname.includes("/api/v1/")) {
    if (API_DENY.test(url.pathname)) return;
    // user-specific data: the Authorization header is part of the request, the cache is wiped on logout / user switch
    event.respondWith(networkFirst(req, API_CACHE, API_MAX_ENTRIES));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((c) => c || fetch(req)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/image") || /\.(?:png|jpe?g|webp|avif|svg|gif|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, MEDIA_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/data/") || req.mode === "navigate" || req.headers.get("RSC")) {
    event.respondWith(
      networkFirst(req, PAGE_CACHE, PAGE_MAX_ENTRIES, {
        fallbackUrl: req.mode === "navigate" ? "/offline.html" : undefined,
        ignoreSearch: false,
      }),
    );
  }
});

// ------------------------------------------------------------------ messages from the app

async function warm(urls) {
  const page = await caches.open(PAGE_CACHE);
  const stat = await caches.open(STATIC_CACHE);
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await page.put(new Request(u), res);
      const assets = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+?\.(?:js|css|woff2?)/g) || []);
      await Promise.all(
        [...assets].map(async (a) => {
          if (await stat.match(a)) return;
          try {
            const r = await fetch(a);
            if (r.ok) await stat.put(a, r);
          } catch (e) {
            /* offline mid-warm: skip */
          }
        }),
      );
    } catch (e) {
      /* skip this page */
    }
  }
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "WARM" && Array.isArray(msg.urls)) {
    event.waitUntil(warm(msg.urls));
  }
  if (msg.type === "CLEAR_USER_DATA") {
    // logout or another account signed in: drop everything user-specific
    event.waitUntil(Promise.all([caches.delete(API_CACHE), caches.delete(PAGE_CACHE)]));
  }
});

// ------------------------------------------------------------------ Web Push

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
