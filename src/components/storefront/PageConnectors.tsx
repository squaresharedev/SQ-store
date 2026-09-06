"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * The lines joining the STOREFRONT to the product pages it has open.
 *
 * Drawn INSIDE the stage, so the curves live in the same coordinate space as
 * the board and the artboards: pan and zoom move all three together with one
 * transform, and this never has to know either value.
 *
 * MEASURED, not computed. Where the board ends and where each page begins is
 * the flex layout's answer (a board width that follows the column count, a
 * gap, however many pages are out), and recomputing it here would be a second
 * implementation of that math which could disagree with the first. Reading
 * both ends out of the DOM cannot.
 *
 * ONE ORIGIN, NOT ONE PER TILE. A line used to leave the product's own tile,
 * which put its start somewhere different for every page and drew it across
 * the middle of the board. The pages belong to the STOREFRONT, so every line
 * now leaves the same point instead: the storefront's own top-right corner,
 * the board's card, not the device-switch row floating above it, which is
 * editor chrome rather than part of the shop.
 *
 * AN ARCH, NOT A SWOOP. A page sits level with the board now (see
 * CONNECTOR_ARC_BAND_PX in DesignerCanvas): a line has no vertical drop to
 * ride down, so it leaves the corner heading straight UP, arcs over, and
 * comes straight back DOWN into the top-centre of its page's own card (again
 * skipping the label row above it, see data-artboard-card in
 * ProductPageArtboard). One cubic Bézier carries both vertical tangents at
 * once, so the whole arch is smooth, with no straight segment or joint for
 * the eye to catch on.
 *
 * TALLER THE FURTHER OUT. Every line shares that one origin and leaves it in
 * the exact same direction (straight up), so two arches of the SAME height
 * would run flush against each other along the whole flat top of the curve,
 * not just cross paths once: the nearer page's line would read as part of
 * the farther one's. Rising higher for each page further out keeps that flat
 * top at a different height per line, the way one arch nested inside another
 * still reads as two: the fan this produces never has to cross itself, only
 * clear the ones already claimed by pages nearer the board.
 */

type Curve = { id: string; d: string; x1: number; y1: number; x2: number; y2: number };

/** How high the FIRST page's arch rises above the corner and its page, in px. */
const ARC_LIFT_BASE = 48;
/** How much higher each page further out rises than the one before it. */
const ARC_LIFT_STEP = 56;
/** Never asked to rise higher than this, so a great many pages open at once
 *  doesn't send an arch (and the band reserved for it, see
 *  CONNECTOR_ARC_BAND_PX in DesignerCanvas) climbing without end. */
const ARC_LIFT_MAX = 216;

/**
 * How far the arch for the page at this position (0 = nearest the board)
 * rises.
 *
 * Stepped by POSITION rather than by the pixel distance it happens to span:
 * position is what the pages are actually ordered by (left to right, nearer
 * to further), so it gives a guaranteed, evenly-spaced climb regardless of
 * how wide any one page's own device switch has it rendering at: two pages
 * a similar pixel distance apart (a narrow mobile one and a wide desktop one,
 * say) still get visibly different heights.
 */
function liftFor(position: number): number {
  return Math.min(ARC_LIFT_MAX, ARC_LIFT_BASE + position * ARC_LIFT_STEP);
}

export function PageConnectors({
  stageRef,
  /** Product ids whose page is open, in the order they were opened. */
  links,
  /** Anything that can move either end: block placement, canvas size, which
   *  pages are open. Re-measured whenever this changes. */
  revision,
}: {
  stageRef: RefObject<HTMLElement | null>;
  links: readonly string[];
  revision: string;
}) {
  const [curves, setCurves] = useState<Curve[]>([]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const board = stage?.querySelector("[data-canvas-board]");
    if (!stage || !board) {
      setCurves([]);
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    // Bounding rects are post-transform; offsetWidth is the layout width, so
    // their ratio IS the live zoom.
    const scale = stage.offsetWidth > 0 ? stageRect.width / stage.offsetWidth : 1;
    const local = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: (rect.left - stageRect.left) / scale,
        top: (rect.top - stageRect.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      };
    };

    // The storefront's own top-right corner.
    const from = local(board);
    const x1 = from.left + from.width;
    const y1 = from.top;

    const next: Curve[] = [];
    // Position in open-order (0 = nearest the board), not the index into
    // `next`: a page whose artboard hasn't mounted yet still holds its place,
    // so the ones after it keep rising by the same step rather than closing
    // the gap.
    links.forEach((id, position) => {
      // The page's own card lives one level inside the artboard the id is on
      // (see data-artboard-card): the label row above it is editor chrome,
      // and skipping it is what keeps the landing point at the same height
      // regardless of how long the product's title happens to be.
      const card = stage.querySelector(
        `[data-artboard-id="${cssEscape(id)}"] [data-artboard-card]`,
      );
      if (!card) return;
      const to = local(card);
      const x2 = to.left + to.width / 2;
      const y2 = to.top;

      // Both control points sit directly ABOVE their own endpoint, at the
      // same lifted height: the curve leaves (x1,y1) on a straight-up tangent,
      // and by the convex-hull property of a Bézier never rises past that
      // height, arrives at (x2,y2) on a straight-down one. That shared height
      // is what turns two vertical tangents into one continuous arch instead
      // of an S: the curve climbs, levels off into the turn, then descends.
      const lift = liftFor(position);
      const apex = Math.min(y1, y2) - lift;
      const d = [
        `M ${r(x1)} ${r(y1)}`,
        `C ${r(x1)} ${r(apex)}, ${r(x2)} ${r(apex)}, ${r(x2)} ${r(y2)}`,
      ].join(" ");

      next.push({ id, d, x1, y1, x2, y2 });
    });
    setCurves(next);
  }, [links, stageRef]);

  // Layout effect: measure in the same frame the artboard appears, so the line
  // is never drawn to where the page WAS.
  useLayoutEffect(() => {
    measure();
  }, [measure, revision]);

  // The board's own height changes as tiles move and the page grows as its
  // design changes; both move an end of a line without re-rendering this.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || links.length === 0) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);
    // The board is what the origin is measured from, and its height follows
    // the rows on it.
    const board = stage.querySelector("[data-canvas-board]");
    if (board) observer.observe(board);
    for (const element of stage.querySelectorAll("[data-artboard-id]")) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [links, measure, stageRef]);

  if (curves.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground"
      data-page-connectors={curves.length}
    >
      {curves.map((curve) => (
        // Solid and reasonably heavy: the canvas is usually looked at zoomed
        // out, where a hairline at 40% is no line at all.
        <g key={curve.id} opacity={0.45}>
          <path
            d={curve.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <circle cx={curve.x1} cy={curve.y1} r={6} fill="currentColor" />
          <circle cx={curve.x2} cy={curve.y2} r={6} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

/** One decimal is well under a pixel at any zoom the canvas allows, and keeps
 *  the path strings readable in the DOM. */
function r(value: number): number {
  return Math.round(value * 10) / 10;
}

/** CSS.escape, with a fallback for the jsdom builds that lack it. Every link
 *  is a uuid, so the fallback is never exercised in practice. */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
