"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { BACK_ONLINE_FLAG } from "@/lib/pwa/paths";
import { isEmbedFramePath } from "@/lib/storefront/embed-frame";

/** A connection that drops for less than this (a wifi handover, a tunnel on a
 *  train) was never worth interrupting anyone for, so it says nothing at all. */
const BLIP_MS = 1500;

/** Whether the offline page was on screen before this page loaded. Read once:
 *  the next page in this tab has nothing to announce. */
function takeBackOnlineFlag(): boolean {
  try {
    const flagged = sessionStorage.getItem(BACK_ONLINE_FLAG) !== null;
    sessionStorage.removeItem(BACK_ONLINE_FLAG);
    return flagged;
  } catch {
    return false; // Storage blocked: the page still works, it just stays quiet.
  }
}

/**
 * Says when the connection drops and when it returns, through the toast stack:
 * pinned while offline, because it stays true until it stops being, then a
 * brief "Back online" in its place.
 *
 * "Back online" also has to work across a page load. A seller who navigates
 * while offline lands on the service worker's offline page, which reloads by
 * itself on reconnecting, so no running page ever sees the event. That page
 * leaves a flag behind for this one to pick up.
 *
 * Mounted once, in the root layout. Not in the embed frame: that runs inside
 * someone else's website, whose own page is what its visitor is looking at.
 */
export function ConnectionStatus() {
  const t = useTranslations("Common.connection");
  const toast = useToast();
  const isEmbedFrame = isEmbedFramePath(usePathname());
  const offlineToast = useRef<number | null>(null);

  useEffect(() => {
    if (isEmbedFrame) return;
    let blip: ReturnType<typeof setTimeout> | undefined;

    const wentOffline = () => {
      clearTimeout(blip);
      blip = setTimeout(() => {
        offlineToast.current = toast.info(t("offline"), { duration: Infinity });
      }, BLIP_MS);
    };

    const cameBack = () => {
      clearTimeout(blip);
      // Nothing was said about going offline, so there is nothing to take back.
      if (offlineToast.current === null) return;
      toast.dismiss(offlineToast.current);
      offlineToast.current = null;
      toast.success(t("backOnline"));
    };

    if (!navigator.onLine) wentOffline();
    else if (takeBackOnlineFlag()) toast.success(t("backOnline"));

    window.addEventListener("offline", wentOffline);
    window.addEventListener("online", cameBack);
    return () => {
      clearTimeout(blip);
      window.removeEventListener("offline", wentOffline);
      window.removeEventListener("online", cameBack);
    };
  }, [isEmbedFrame, t, toast]);

  return null;
}
