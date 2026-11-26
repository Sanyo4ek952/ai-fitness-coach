/* global self, caches */
// Replaced by build-pwa.mjs. No runtime caching or access to user data.
const VERSION = "__PWA_VERSION__";
const ASSETS = /* __PWA_ASSETS__ */ [];
const INTEGRITY = /* __PWA_INTEGRITY__ */ {};
const PREFIX = "fitness-shell-";
const CACHE = PREFIX + VERSION;
const allowed = new Set(ASSETS);

self.addEventListener("install", (event) => {
  // addAll is atomic: a missing resource prevents activation of this version.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    ASSETS.map((path) => new Request(new URL(path, self.location.origin), { cache: "reload", integrity: INTEGRITY[path] })),
  )));
  // Deliberately no skipWaiting: an open workout must keep its current code.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Only Next's cache-busting RSC query is ignored. Test/fault/private URLs
  // never enter the cache and never receive a cached production document.
  if ([...url.searchParams.keys()].some((key) => key !== "_rsc")) return;
  let path = url.pathname;
  if (request.mode === "navigate" && !path.endsWith("/")) path += "/";
  if (!allowed.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(path);
    // A browser may evict a cache. Do not fabricate a successful response.
    return saved ?? fetch(request);
  })());
});

self.addEventListener("message", (event) => {
  if (!["OFFLINE_STATUS", "PREPARE_OFFLINE"].includes(event.data?.type) || !event.ports[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const cache = await caches.open(CACHE);
      if (event.data.type === "PREPARE_OFFLINE") {
        await cache.addAll(ASSETS.map((path) => new Request(new URL(path, self.location.origin), { cache: "reload", integrity: INTEGRITY[path] })));
      }
      ready = (await Promise.all(ASSETS.map((path) => cache.match(path)))).every(Boolean);
    } catch { /* Unavailable storage must not be reported as ready. */ }
    event.ports[0].postMessage({ type: "OFFLINE_STATUS", ready, version: VERSION });
  })());
});
