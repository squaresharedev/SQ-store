/*
 * THE SERVICE WORKER. One job: when a page can't load because the device is
 * offline, show the app's own offline page (app/offline/route.ts) instead of
 * the browser's error screen. Every request still goes to the network exactly
 * as if this file did not exist.
 *
 * NOTHING THE APP SERVES IS CACHED. The dashboard is private, per-account and
 * changes by the second, so a stored page would show a seller stale data, or
 * the data of the account they were in before switching. The one thing kept
 * is the offline page, which holds no account data at all.
 *
 * Plain JS in public/ because a worker must be served as a standalone script
 * from the scope it controls ("/"), so it cannot import app modules. The two
 * values it shares with the app are mirrored below, and tests/unit/pwa.test.ts
 * fails if either copy drifts.
 */

// Mirrors OFFLINE_PATH in src/lib/pwa/paths.ts.
const OFFLINE_URL = "/offline";
// Mirrors OFFLINE_LOCALE_MESSAGE in src/lib/pwa/paths.ts.
const LOCALE_MESSAGE = "offline-locale";

// Bump the version to replace the stored offline page on every install at once.
const CACHE_PREFIX = "sq-offline-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;

/** Stores a fresh copy of the offline page, in the language the cookie says. */
async function storeOfflinePage() {
  const cache = await caches.open(CACHE_NAME);
  // "reload" skips the HTTP cache, so the copy is current.
  await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(storeOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      // The browser starts the page's request while this worker boots, so
      // routing navigations through here costs nothing while online.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Page loads only. Data, assets and server actions never come through here.
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || (await fetch(request));
      } catch {
        // fetch() rejects only when the network itself failed. A server error
        // is still a response, and it went straight back above.
        const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME });
        return offline || Response.error();
      }
    })(),
  );
});

// The page reports its language on every load; re-fetch the offline page only
// when the stored copy is in a different one.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== LOCALE_MESSAGE || typeof data.locale !== "string") return;

  event.waitUntil(
    (async () => {
      const stored = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME });
      if (stored && stored.headers.get("Content-Language") === data.locale) return;
      await storeOfflinePage();
    })(),
  );
});
