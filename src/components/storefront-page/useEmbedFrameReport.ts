"use client";

import { useEffect, type RefObject } from "react";
import { EMBED_MESSAGE_SOURCE, type EmbedFrameMessage } from "@/lib/storefront/embed-frame";

/**
 * Tell the page this frame sits in how tall its content is, and what to call
 * it. That is the frame's one message, sent in one direction: it listens for
 * nothing, so nothing a page says to it can change what it shows.
 *
 * WHY A MESSAGE AT ALL. A frame's height is set by the page that holds it, and
 * that page is another site: it cannot measure this one. The loader
 * (public/widget.js) starts the frame at no height and gives it the one it is
 * told, which is also why a frame that was refused, and so never runs this,
 * stays invisible instead of leaving a blank box on a seller's website.
 *
 * ADDRESSED, not broadcast: the message is posted to `site`, the one origin
 * the server already checked against the seller's allowlist, never to "*".
 * The browser drops it if the page holding the frame is anything else.
 */
export function useEmbedFrameReport(
  rootRef: RefObject<HTMLElement | null>,
  /** The embedding site's host, as the frame's address named it. */
  site: string,
  title: string,
) {
  useEffect(() => {
    const root = rootRef.current;
    // Not in a frame (the dev gallery, a test render): nobody to tell.
    if (!root || window.parent === window) return;

    // The frame is only ever drawn on a site with its own scheme: the policy
    // it is served under names no other.
    const target = `${window.location.protocol}//${site}`;
    const report = () => {
      const message: EmbedFrameMessage = {
        source: EMBED_MESSAGE_SOURCE,
        height: Math.ceil(root.getBoundingClientRect().height),
        title,
      };
      window.parent.postMessage(message, target);
    };

    // Once now, measured directly: an observer may not fire for a frame that
    // is still no taller than nothing. Then on every change, which covers the
    // board reflowing to a narrow column, a typeface arriving and a photo
    // settling.
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef, site, title]);
}
