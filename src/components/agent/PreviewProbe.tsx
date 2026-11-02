"use client";

import { useEffect } from "react";
import { PREVIEW_TARGETS_ELEMENT_ID, type PreviewMeasurements } from "@/lib/agent/preview/targets";

/** Longest the probe waits for photos and fonts before measuring anyway. */
const SETTLE_TIMEOUT_MS = 8_000;

export type ProbeTarget = { href: string; productId: string; title: string; status: string };

/**
 * On a preview page only (app/(public)/agent-preview): once photos and fonts
 * have settled, measure where each product tile was drawn, write it into the
 * page as JSON, and mark <html data-preview-ready>. The headless browser waits
 * for that mark before its screenshot, so the picture and the measurements are
 * of the same finished page. Draws nothing.
 */
export function PreviewProbe({ targets }: { targets: ProbeTarget[] }) {
  useEffect(() => {
    let cancelled = false;
    const images = Array.from(document.images).filter((image) => !image.complete);
    const settled = Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...images.map((image) => new Promise((resolve) => image.addEventListener("loadend", resolve, { once: true }))),
    ]);
    const timeout = new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS));
    void Promise.race([settled, timeout]).then(() => {
      // Two frames, so the last image's layout has been painted.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
          const tiles = targets.flatMap((target) => {
            const anchor = anchors.find((candidate) => candidate.getAttribute("href") === target.href);
            if (!anchor) return [];
            const box = anchor.getBoundingClientRect();
            return [
              {
                productId: target.productId,
                title: target.title,
                status: target.status,
                x: Math.round(box.left + window.scrollX),
                y: Math.round(box.top + window.scrollY),
                w: Math.round(box.width),
                h: Math.round(box.height),
              },
            ];
          });
          const measured: PreviewMeasurements = {
            page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            tiles,
          };
          const element = document.createElement("script");
          element.type = "application/json";
          element.id = PREVIEW_TARGETS_ELEMENT_ID;
          // `<` escaped, so no title can close the element it sits in.
          element.textContent = JSON.stringify(measured).replace(/</g, "\\u003c");
          document.body.appendChild(element);
          document.documentElement.dataset.previewReady = "";
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [targets]);
  return null;
}
