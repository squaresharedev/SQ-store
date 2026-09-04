"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * The lines joining a product tile to its open product page.
 *
 * Drawn INSIDE the stage, so the curves live in the same coordinate space as
 * the board and the artboards: pan and zoom move all three together with one
 * transform, and this never has to know either value.
 *
 * MEASURED, not computed. A tile's position on the board is the grid's answer
 * (cells, gaps, a responsive column count, a tilt), and recomputing it here
 * would be a second implementation of that math which could disagree with the
 * first. Reading both ends out of the DOM cannot.
 */
export type PageLink = {
  /** The tile's grid key, `p_<productId>`. */
  fromKey: string;
  /** The artboard's product id. */
  toId: string;
};

type Curve = { id: string; d: string; x1: number; y1: number; x2: number; y2: number };

/** Where the curve meets the artboard: just under its label, so the line reads
 *  as arriving at the top of the page rather than at its middle. */
const ARTBOARD_ENTRY_Y = 52;

export function PageConnectors({
  stageRef,
  links,
  /** Anything that can move either end: block placement, canvas size, which
   *  pages are open. Re-measured whenever this changes. */
  revision,
}: {
  stageRef: RefObject<HTMLElement | null>;
  links: readonly PageLink[];
  revision: string;
}) {
  const [curves, setCurves] = useState<Curve[]>([]);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
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

    const next: Curve[] = [];
    for (const link of links) {
      const tile = stage.querySelector(`[data-grid-key="${cssEscape(link.fromKey)}"]`);
      const board = stage.querySelector(`[data-artboard-id="${cssEscape(link.toId)}"]`);
      if (!tile || !board) continue;
      const from = local(tile);
      const to = local(board);
      const x1 = from.left + from.width;
      const y1 = from.top + from.height / 2;
      const x2 = to.left;
      const y2 = to.top + Math.min(ARTBOARD_ENTRY_Y, to.height / 2);
      // A flat S: the handles reach along x only, so the curve leaves the tile
      // and arrives at the page horizontally however far apart they are.
      const reach = Math.max(64, (x2 - x1) * 0.45);
      next.push({
        id: link.toId,
        d: `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`,
        x1,
        y1,
        x2,
        y2,
      });
    }
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

/** CSS.escape, with a fallback for the jsdom builds that lack it. Both ends of
 *  a link are uuids, so the fallback is never exercised in practice. */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
