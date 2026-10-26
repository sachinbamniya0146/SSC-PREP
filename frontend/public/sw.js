// SSC Prep Hub service worker v3: offline-capable app.
//
//  1. App shell + pages: warmed pages and all their JS / CSS / fonts are cached, so the app opens with no internet.
//  2. API reads (GET): network-first, falling back to the last good copy. Copies carry a timestamp and EXPIRE
//     (7 days, 1 day for subscription / profile / mock lists), so an old copy can never show stale premium access.
//  3. Offline fallback: exact page -> same page without ?query (e.g. /test?template=X) -> the /offline hub -> offline.html.
//  4. Question images (any origin, e.g. the CDN): cached for real (CORS copy when the CDN allows it, so the quota is
//     not padded like an opaque response), pack images live in their own cache that is never auto-trimmed.
//  5. Web Push notifications (admin broadcast tool, see backend/src/push).
//
// v3 fixes (found by reproducing on a production build, see UPDATE_OFFLINE_REAL_FIX_OCT2026.md):
//  - cross-origin question images were never cached (old code returned early for other origins)
//  - lazy chunks / fonts that are only named inside the Next flight data or inside CSS were not warmed
//  - /test?template=X offline fell to the generic offline page although /test was cached
//  - API copies had no expiry; the static cache was never trimmed
//  - the app had no way to ask the worker what is stored (status screen) or to report warm progress
//
// Writes (POST/PUT/DELETE) are never touched here: the app queues test submits itself (lib/offline-submit.ts).

const VERSION = "v3";
const SHELL_CACHE = `ssc-shell-${VERSION}`; // precached icons / offline page
const STATIC_CACHE = `ssc-static-${VERSION}`; // /_next/static (hashed, immutable)
const PAGE_CACHE = `ssc-pages-${VERSION}`; // HTML + RSC payloads of visited pages
const API_CACHE = `ssc-api-${VERSION}`; // GET /api/v1/*
const MEDIA_CACHE = `ssc-media-${VERSION}`; // site images, fonts, random cross-origin images
const PACK_IMG_CACHE = "ssc-packimg-v1"; // images of downloaded packs (unversioned: survives worker updates)
const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, PAGE_CACHE, API_CACHE, MEDIA_CACHE, PACK_IMG_CACHE];

const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-192-maskable.png",
  "/icon-512-maskable.png",
  "/logo.png",
];

const API_MAX_ENTRIES = 300;
const PAGE_MAX_ENTRIES = 120;
const STATIC_MAX_ENTRIES = 900;
const MEDIA_MAX_ENTRIES = 150;
const NETWORK_TIMEOUT_MS = 4000;
const DAY = 24 * 3600 * 1000;
const API_MAX_AGE = 7 * DAY;
// user / money / access sensitive reads: a saved copy older than this is NOT served
const API_SHORT_AGE = 1 * DAY;
const API_SHORT = /\/api\/v1\/(users\/me|payments\/subscription|subscriptions?|mocks|tests(\?|$)|gamification\/me)/;
const STAMP = "x-sw-cached-at";

// never cache these API areas (auth, admin tools, live chat, payments, push, payouts)
const API_DENY = /\/api\/v1\/(auth|admin|chat|support-chat|push|telegram|payments\/(order|webhook|verify)|referral\/withdraw)/;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => undefined)))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
      await broadcast({ type: "SW_ACTIVATED", version: VERSION });
    })(),
  );
});

// ------------------------------------------------------------------ helpers

async function broadcast(msg) {
  try {
    const all = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
    all.forEach((c) => c.postMessage(msg));
  } catch (e) {
    /* ignore */
  }
}

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

/** Stores a copy of an API response with a timestamp header so it can expire. */
async function putStamped(cache, request, res) {
  const headers = new Headers(res.headers);
  headers.set(STAMP, String(Date.now()));
  const body = await res.blob();
  await cache.put(request, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

function apiMaxAge(url) {
  return API_SHORT.test(url) ? API_SHORT_AGE : API_MAX_AGE;
}

function offlineJson(message, extra) {
  return new Response(JSON.stringify({ message, offline: true, ...(extra || {}) }), {
    status: 503,
    headers: { "Content-Type": "application/json", "X-Offline": "1" },
  });
}

/** API reads: network first; offline -> last good copy if it is still fresh enough. */
async function apiNetworkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (res && res.ok && (res.type === "basic" || res.type === "cors")) {
      putStamped(cache, request, res.clone())
        .then(() => trim(API_CACHE, API_MAX_ENTRIES))
        .catch(() => undefined);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) {
      const at = Number(hit.headers.get(STAMP) || 0);
      if (at && Date.now() - at <= apiMaxAge(request.url)) {
        const headers = new Headers(hit.headers);
        headers.set("X-From-Cache", "1");
        return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
      }
      cache.delete(request).catch(() => undefined); // too old: drop it, never serve it
    }
    return offlineJson("Offline: ye data abhi saved nahi hai.");
  }
}

/** Pages: network first (4 s), then cache, then the offline hub. */
async function pageNetworkFirst(request) {
  const cache = await caches.open(PAGE_CACHE);
  const isNav = request.mode === "navigate";
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (res && res.ok && res.type === "basic") {
      cache.put(request, res.clone()).then(() => trim(PAGE_CACHE, PAGE_MAX_ENTRIES)).catch(() => undefined);
    }
    return res;
  } catch (err) {
    const exact = await cache.match(request);
    if (exact) return exact;
    if (isNav) {
      // /test?template=X, /results?x=1 ... the HTML is the same app shell, the page reads the query itself
      const bare = await cache.match(request, { ignoreSearch: true });
      if (bare) return bare;
      const hub = await cache.match("/offline");
      if (hub) return hub;
      const fb = await caches.match("/offline.html");
      if (fb) return fb;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    cache
      .put(request, res.clone())
      .then(() => (max ? trim(cacheName, max) : undefined))
      .catch(() => undefined);
  }
  return res;
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === "opaque")) {
        cache
          .put(request, res.clone())
          .then(() => (max ? trim(cacheName, max) : undefined))
          .catch(() => undefined);
      }
      return res;
    })
    .catch(() => undefined);
  return hit || (await refresh) || Response.error();
}

/**
 * An image from another origin (the CDN). <img> asks in no-cors mode, which would give an OPAQUE response
 * (cached copy "weighs" ~7 MB in the storage quota). So the worker first tries the same URL with CORS: if the CDN
 * allows it we cache a normal, small response; otherwise we fall back to the opaque copy.
 */
async function crossOriginImage(request) {
  const url = request.url;
  const packHit = await (await caches.open(PACK_IMG_CACHE)).match(url);
  if (packHit) return packHit;
  const media = await caches.open(MEDIA_CACHE);
  const hit = await media.match(url);
  if (hit) return hit;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (res && res.ok) {
      media.put(url, res.clone()).then(() => trim(MEDIA_CACHE, MEDIA_MAX_ENTRIES)).catch(() => undefined);
      return res;
    }
  } catch (e) {
    /* CDN without CORS headers: fall through to the opaque copy */
  }
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) {
    media.put(url, res.clone()).then(() => trim(MEDIA_CACHE, 40)).catch(() => undefined);
  }
  return res;
}

// ------------------------------------------------------------------ fetch routing

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API reads, any origin (same-origin /api/v1 or the :4000 LAN API)
  if (url.pathname.includes("/api/v1/")) {
    if (API_DENY.test(url.pathname)) return;
    // user-specific data: the cache is wiped on logout / user switch and every copy expires (see API_SHORT)
    event.respondWith(apiNetworkFirst(req));
    return;
  }

  if (url.origin !== self.location.origin) {
    if (req.destination === "image") event.respondWith(crossOriginImage(req));
    return;
  }

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(req).then((c) => c || fetch(req)));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE, STATIC_MAX_ENTRIES));
    return;
  }

  if (url.pathname.startsWith("/_next/image") || /\.(?:png|jpe?g|webp|avif|svg|gif|ico|woff2?|ttf)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, MEDIA_CACHE, MEDIA_MAX_ENTRIES));
    return;
  }

  if (url.pathname.startsWith("/_next/data/") || req.mode === "navigate" || req.headers.get("RSC")) {
    event.respondWith(pageNetworkFirst(req));
  }
});

// ------------------------------------------------------------------ warm / images / status

function reply(event, msg) {
  try {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(msg);
    else broadcast(msg);
  } catch (e) {
    /* ignore */
  }
}

/** Asset URLs named in HTML / flight data / CSS. */
function findAssets(text) {
  const out = new Set();
  const abs = text.match(/\/_next\/static\/[^"'\\\s)]+?\.(?:js|css|woff2?)/g) || [];
  abs.forEach((a) => out.add(a));
  // flight data names lazy chunks without the leading /_next/
  const re = /["'\s,:\[(]static\/((?:chunks|css|media)\/[^"'\\\s)]+?\.(?:js|css|woff2?))/g;
  let m;
  while ((m = re.exec(text))) out.add("/_next/static/" + m[1]);
  return [...out];
}

async function fetchAsset(stat, a) {
  if (await stat.match(a)) return;
  try {
    const r = await fetch(a);
    if (!r.ok) return;
    if (/\.css$/.test(a)) {
      // fonts used by the stylesheet: url(../media/xxx.woff2)
      const css = await r.clone().text();
      const fonts = new Set();
      (css.match(/url\(([^)]+\.woff2?)\)/g) || []).forEach((m) => {
        const p = m.slice(4, -1).replace(/["']/g, "");
        try {
          fonts.add(new URL(p, self.location.origin + a).pathname);
        } catch (e) {
          /* ignore */
        }
      });
      await Promise.all([...fonts].map((f) => fetchAsset(stat, f)));
    }
    await stat.put(a, r);
  } catch (e) {
    /* offline mid-warm: skip */
  }
}

async function warm(urls, event) {
  const page = await caches.open(PAGE_CACHE);
  const stat = await caches.open(STATIC_CACHE);
  let done = 0;
  let failed = 0;
  for (const u of urls) {
    try {
      const res = await fetch(u, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (!res.ok || res.redirected) {
        // redirected = not signed in (login page): saving it under this URL would be wrong
        failed++;
      } else {
        const html = await res.clone().text();
        await page.put(new Request(u), res);
        await Promise.all(findAssets(html).map((a) => fetchAsset(stat, a)));
      }
    } catch (e) {
      failed++;
    }
    done++;
    reply(event, { type: "WARM_PROGRESS", done, total: urls.length, failed });
  }
  reply(event, { type: "WARM_DONE", done, total: urls.length, failed, at: Date.now() });
  trim(STATIC_CACHE, STATIC_MAX_ENTRIES).catch(() => undefined);
}

async function cacheImages(urls, event) {
  const cache = await caches.open(PACK_IMG_CACHE);
  let done = 0;
  let failed = 0;
  for (const u of urls) {
    try {
      if (await cache.match(u)) {
        done++;
        continue;
      }
      let res = null;
      try {
        res = await fetch(u, { mode: "cors", credentials: "omit" });
      } catch (e) {
        res = null;
      }
      if (!res || !res.ok) res = await fetch(u, { mode: "no-cors", credentials: "omit" }); // opaque, still usable by <img>
      if (res && (res.ok || res.type === "opaque")) {
        await cache.put(u, res);
        done++;
      } else failed++;
    } catch (e) {
      failed++;
    }
    reply(event, { type: "IMAGES_PROGRESS", done: done + failed, total: urls.length, failed });
  }
  reply(event, { type: "IMAGES_DONE", done, total: urls.length, failed });
}

async function status() {
  const out = { version: VERSION, caches: {} };
  for (const k of ALL_CACHES) {
    try {
      const c = await caches.open(k);
      const keys = await c.keys();
      out.caches[k] = keys.length;
      if (k === PAGE_CACHE) out.pages = keys.map((r) => new URL(r.url).pathname);
      if (k === PACK_IMG_CACHE) out.packImages = keys.map((r) => r.url);
    } catch (e) {
      out.caches[k] = 0;
    }
  }
  return out;
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "GET_VERSION") reply(event, { type: "VERSION", version: VERSION });
  if (msg.type === "WARM" && Array.isArray(msg.urls)) event.waitUntil(warm(msg.urls, event));
  if (msg.type === "CACHE_IMAGES" && Array.isArray(msg.urls)) event.waitUntil(cacheImages(msg.urls, event));
  if (msg.type === "DROP_IMAGES" && Array.isArray(msg.urls)) {
    event.waitUntil(caches.open(PACK_IMG_CACHE).then((c) => Promise.all(msg.urls.map((u) => c.delete(u)))));
  }
  if (msg.type === "STATUS") event.waitUntil(status().then((s) => reply(event, { type: "STATUS", ...s })));
  if (msg.type === "CLEAR_USER_DATA") {
    // logout or another account signed in: drop everything user-specific
    event.waitUntil(Promise.all([caches.delete(API_CACHE), caches.delete(PAGE_CACHE)]));
  }
  if (msg.type === "CLEAR_ALL") {
    event.waitUntil(Promise.all(ALL_CACHES.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))));
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
