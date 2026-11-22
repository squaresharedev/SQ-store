"use client";

import { useEffect } from "react";
import { GRID_ROOT_CLASS } from "@/components/grid/gridConstants";
import {
  PREVIEW_REGION_ELEMENT_ID,
  PREVIEW_TARGETS_ELEMENT_ID,
  regionBox,
  resolvedTracks,
  type CellRegion,
  type MeasuredBoard,
  type PageBox,
  type PreviewMeasurements,
} from "@/lib/agent/preview/targets";

/** Longest the probe waits for photos and fonts before measuring anyway. */
const SETTLE_TIMEOUT_MS = 8_000;

export type ProbeTarget = { href: string; productId: string; title: string; status: string };

/** The storefront board's grid on this page: the first one in the page view. */
const BOARD_GRID_SELECTOR = `[data-storefront-page] .${GRID_ROOT_CLASS}`;

/** The board's grid as drawn: its page box and its tracks, or null without one. */
function measureGrid() {
  const grid = document.querySelector<HTMLElement>(BOARD_GRID_SELECTOR);
  if (!grid) return null;
  const box = grid.getBoundingClientRect();
  const style = getComputedStyle(grid);
  const columns = resolvedTracks(style.gridTemplateColumns);
  const rows = resolvedTracks(style.gridTemplateRows);
  if (!columns || !rows) return null;
  return {
    x: box.left + window.scrollX,
    y: box.top + window.scrollY,
    w: box.width,
    h: box.height,
    columns,
    rows,
    columnGap: Number.parseFloat(style.columnGap) || 0,
    rowGap: Number.parseFloat(style.rowGap) || 0,
  };
}

/**
 * An invisible box exactly over `box`, for the photographing browser to crop
 * to by its id. Placed, then corrected by where it actually landed, so a
 * positioned ancestor cannot shift it.
 */
function markRegion(box: PageBox): void {
  const marker = document.createElement("div");
  marker.id = PREVIEW_REGION_ELEMENT_ID;
  marker.setAttribute("aria-hidden", "true");
  const place = (left: number, top: number) => {
    marker.style.setProperty("left", `${left}px`);
    marker.style.setProperty("top", `${top}px`);
  };
  marker.style.setProperty("position", "absolute");
  marker.style.setProperty("pointer-events", "none");
  marker.style.setProperty("width", `${box.w}px`);
  marker.style.setProperty("height", `${box.h}px`);
  place(box.x, box.y);
  document.body.appendChild(marker);
  const landed = marker.getBoundingClientRect();
  place(box.x + (box.x - (landed.left + window.scrollX)), box.y + (box.y - (landed.top + window.scrollY)));
}

const rounded = (box: PageBox): PageBox => ({
  x: Math.round(box.x),
  y: Math.round(box.y),
  w: Math.round(box.w),
  h: Math.round(box.h),
});

/**
 * On a preview page only (app/(public)/agent-preview): once photos and fonts
 * have settled, measure where each product tile and the board's grid were
 * drawn, write it into the page as JSON, and mark <html data-preview-ready>.
 * The headless browser waits for that mark before its screenshot, so the
 * picture and the measurements are of the same finished page. Asked for a
 * `region` of cells, it also lays an invisible box over exactly those cells,
 * which the browser crops its picture to. Draws nothing visible.
 */
export function PreviewProbe({ targets, region }: { targets: ProbeTarget[]; region?: CellRegion | null }) {
  const regionX = region?.x;
  const regionY = region?.y;
  const regionW = region?.w;
  const regionH = region?.h;
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
          const grid = measureGrid();
          const board: MeasuredBoard | undefined = grid
            ? { ...rounded(grid), columns: grid.columns.length, rows: grid.rows.length }
            : undefined;
          const asked =
            grid && regionX !== undefined && regionY !== undefined && regionW !== undefined && regionH !== undefined
              ? regionBox(grid, { x: regionX, y: regionY, w: regionW, h: regionH })
              : null;
          if (asked) markRegion(asked);
          const measured: PreviewMeasurements = {
            page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            tiles,
            ...(board ? { board } : {}),
            ...(asked ? { region: rounded(asked) } : {}),
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
  }, [targets, regionX, regionY, regionW, regionH]);
  return null;
}
