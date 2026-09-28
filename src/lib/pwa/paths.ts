/** Where the installable-app plumbing lives. Pure strings: safe on the server
 *  and the client. public/sw.js cannot import this module, so it mirrors the
 *  values it needs, and tests/unit/pwa.test.ts holds the two copies together. */

/** The service worker script. At the root because a worker can only control
 *  the paths at or below its own URL, and the app needs all of them. */
export const SERVICE_WORKER_PATH = "/sw.js";

/** The self-contained page the service worker shows when a page can't load
 *  because the device is offline (app/offline/route.ts). */
export const OFFLINE_PATH = "/offline";

/** The message the page sends the service worker with its current language,
 *  so the stored offline page can be re-fetched after the seller switches. */
export const OFFLINE_LOCALE_MESSAGE = "offline-locale";
