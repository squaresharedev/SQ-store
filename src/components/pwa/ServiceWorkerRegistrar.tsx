"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { OFFLINE_LOCALE_MESSAGE, SERVICE_WORKER_PATH } from "@/lib/pwa/paths";
import { PUBLIC_PAGES_PREFIX } from "@/lib/storefront/product-page-url";

/**
 * Registers the service worker (public/sw.js), which gives the installed app
 * its own offline page instead of the browser's. Mounted once, in the root
 * layout, and skipped on the buyer-facing pages: they are not the app, and a
 * buyer's browser has no use for the dashboard's worker.
 *
 * Best-effort. Registration can fail (private windows, a browser with workers
 * off) and the app behaves identically without it, so a failure is ignored.
 *
 * Also tells the worker the page's language on every load, so the offline
 * page it keeps follows the seller's language after a switch.
 */
export function ServiceWorkerRegistrar() {
  const locale = useLocale();
  const isPublicPage = usePathname().startsWith(PUBLIC_PAGES_PREFIX);

  useEffect(() => {
    if (isPublicPage || !("serviceWorker" in navigator)) return;
    let cancelled = false;

    navigator.serviceWorker
      // updateViaCache "none": a new sw.js is picked up on the next load,
      // never held back by the HTTP cache.
      .register(SERVICE_WORKER_PATH, { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        if (cancelled) return;
        registration.active?.postMessage({ type: OFFLINE_LOCALE_MESSAGE, locale });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isPublicPage, locale]);

  return null;
}
