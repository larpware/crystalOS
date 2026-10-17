/* ==========================================================================
   CrystalOS service worker

   Two jobs, one worker — they have to share the root scope, because a page is
   only intercepted by the service worker that controls it:

   1. Scramjet routing. The official Scramjet controller script is imported
      from the backend, and every request under its prefix is answered by it.
      The proxy's own worker (what the official bootstrap generated) did only
      this; the offline cache below is why the shell keeps its own copy, so
      development and the production build run the same worker.
   2. Offline shell. Navigations are network-first with a cached fallback,
      hashed build assets are cache-first, and remote wallpapers are kept with
      a size cap.

   If the Scramjet backend is not running, the import fails harmlessly: the
   controller simply is not present, proxied frames report the outage, and the
   rest of CrystalOS keeps working offline as before.
   ========================================================================== */

let scramjetReady = false;
try {
  importScripts("/controller/controller.sw.js");
  scramjetReady = typeof $scramjetController?.shouldRoute === "function";
} catch (error) {
  console.warn("[crescent] Scramjet controller unavailable:", error);
}

self.addEventListener("fetch", (event) => {
  if (!scramjetReady) return;
  try {
    if ($scramjetController.shouldRoute(event)) {
      event.respondWith($scramjetController.route(event));
    }
  } catch (error) {
    console.warn("[crescent] Scramjet routing failed:", error);
  }
});

const VERSION = "crescent-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const IMAGE_CACHE = `${VERSION}-images`;
const IMAGE_LIMIT = 40;

/** Replaced at install time with the shell document. */
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, "/manifest.webmanifest"]))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("crescent-") && !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const key of keys.slice(0, keys.length - limit)) {
    await cache.delete(key);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Proxied pages are answered by the Scramjet controller above; the offline
  // cache must never see them.
  if (scramjetReady && url.pathname.startsWith("/~/sj/")) return;

  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(SHELL_URL, response.clone());
          return response;
        } catch {
          const cached = (await caches.match(SHELL_URL)) ?? (await caches.match(request));
          return (
            cached ??
            new Response("CrystalOS is offline and no cached copy is available yet.", {
              status: 503,
              headers: { "content-type": "text/plain" },
            })
          );
        }
      })(),
    );
    return;
  }

  if (!sameOrigin) {
    // Remote wallpaper photography is the only cross-origin asset worth keeping.
    if (request.destination === "image" && url.hostname.endsWith("unsplash.com")) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(IMAGE_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;
          try {
            const response = await fetch(request);
            if (response.ok) {
              await cache.put(request, response.clone());
              void trimCache(IMAGE_CACHE, IMAGE_LIMIT);
            }
            return response;
          } catch (error) {
            if (cached) return cached;
            throw error;
          }
        })(),
      );
    }
    return;
  }

  // Scramjet client assets belong to the proxy, not to the offline shell.
  if (
    url.pathname.startsWith("/scram/") ||
    url.pathname.startsWith("/controller/") ||
    url.pathname.startsWith("/clients/") ||
    url.pathname === "/bootstrap-init.js"
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && (url.pathname.startsWith("/assets/") || request.destination === "image")) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const shell = await caches.match(SHELL_URL);
        if (shell && request.destination === "document") return shell;
        throw error;
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "crescent:skip-waiting") self.skipWaiting();
});
