/*
 * THE SERVICE WORKER. Two jobs, both about a page that can't load:
 *
 * 1. When the device is offline, show the app's own offline page
 *    (app/offline/route.ts) instead of the browser's error screen.
 * 2. When Cloudflare stopped the Worker mid-request for running past its plan's
 *    CPU allowance (its own "Error 1102" page, which the app never gets to
 *    answer), ask again, spread out over a few seconds, before showing it.
 *    The allowance refills within seconds, so a later try is usually served.
 *
 * Only page loads and page changes (the router's fetch of the next page) pass
 * through here, and only GETs: a server action that was stopped may already
 * have written something, so it is never sent twice. Everything else, and
 * every first try, goes to the network exactly as if this file did not exist.
 *
 * NOTHING THE APP SERVES IS CACHED. The dashboard is private, per-account and
 * changes by the second, so a stored page would show a seller stale data, or
 * the data of the account they were in before switching. The one thing kept
 * is the offline page, which holds no account data at all.
 *
 * Plain JS in public/ because a worker must be served as a standalone script
 * from the scope it controls ("/"), so it cannot import app modules. The
 * values it shares with the app are mirrored below, and tests/unit/pwa.test.ts
 * fails if any copy drifts.
 */

// Mirrors OFFLINE_PATH in src/lib/pwa/paths.ts.
const OFFLINE_URL = "/offline";
// Mirrors OFFLINE_LOCALE_MESSAGE in src/lib/pwa/paths.ts.
const LOCALE_MESSAGE = "offline-locale";

// Bump the version to replace the stored offline page on every install at once.
const CACHE_PREFIX = "sq-offline-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;

// How long to wait before each new try of a request Cloudflare stopped at the
// Worker's CPU limit (ms): six more tries over about fifteen seconds, then the
// error page is shown as it came. In production a stopped Worker took from a
// few seconds to over half a minute to answer again, and three seconds of
// tries lost most of those pages. Mirrors RETRY_DELAYS_MS in
// src/lib/resilient-action.ts, which the sign-in screens' actions wait on.
const LIMIT_RETRY_DELAYS_MS = [500, 1000, 2000, 3000, 4000, 5000];
// How Cloudflare's own error page names that stop (status 503).
const WORKER_LIMIT_PAGE = /error\s*(code:?\s*)?1102|worker exceeded resource limits/i;
// The headers Next.js's router marks its fetch of the next page with
// (next/dist/client/components/app-router-headers.js).
const RSC_HEADER = "rsc";
const PREFETCH_HEADER = "next-router-prefetch";

/**
 * A page load, or a page change the app's router asks for. A prefetch is
 * left alone: losing one costs nothing, and a retry would only add load at
 * the moment the Worker has least to spare.
 */
function isPageRequest(request) {
  if (request.method !== "GET") return false;
  if (request.mode === "navigate") return true;
  return (
    request.headers.get(RSC_HEADER) === "1" &&
    !request.headers.has(PREFETCH_HEADER) &&
    new URL(request.url).origin === self.location.origin
  );
}

/** Whether this answer is Cloudflare's page for a Worker stopped at its limit. */
async function hitWorkerLimit(response) {
  if (response.status !== 503) return false;
  const text = await response.clone().text().catch(() => "");
  return WORKER_LIMIT_PAGE.test(text);
}

/** Asks again while the answer is the limit page; the last answer stands. */
async function retryWorkerLimit(request, response) {
  for (const delay of LIMIT_RETRY_DELAYS_MS) {
    if (!(await hitWorkerLimit(response))) return response;
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await fetch(request);
  }
  return response;
}

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
  // Page loads and page changes only. Data, assets, prefetches and server
  // actions never come through here.
  if (!isPageRequest(request)) return;
  const navigation = request.mode === "navigate";

  event.respondWith(
    (async () => {
      try {
        const first = (navigation && (await event.preloadResponse)) || (await fetch(request));
        return await retryWorkerLimit(request, first);
      } catch {
        // fetch() rejects only when the network itself failed. A server error
        // is still a response, and it went straight back above. A page change
        // fails as it would have without this worker: the router then loads
        // the page in full, which lands here as a page load.
        if (!navigation) return Response.error();
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
