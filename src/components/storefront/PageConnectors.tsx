"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * The lines joining the STOREFRONT to the pages it has open, and each chained
 * page to the one before it (product page, then checkout, then thank-you).
 *
 * Drawn INSIDE the stage, so the lines live in the same coordinate space as
 * the board and the artboards: pan and zoom move all of them together with
 * one transform, and this never has to know either value.
 *
 * MEASURED, not computed. Where each card begins and ends is the flex layout's
 * answer, and recomputing it here would be a second implementation of that
 * math which could disagree with the first. Reading both ends out of the DOM
 * cannot.
 *
 * SIDE TO SIDE, THROUGH THE GAPS, NEVER THROUGH WORDS. Every card has a label
 * row above it (the page's title, its device switch and close button; the
 * board's own device switch), so a line that left or reached a card through
 * its top edge ran straight through that text. Lines now leave a card's RIGHT
 * edge and arrive at the next card's LEFT edge, a little below the top, which
 * is empty canvas on both sides:
 *
 *   - NEIGHBOURS (nothing in between, the usual case: board to first page,
 *     page to its checkout, checkout to its thank-you) are joined by a
 *     straight run across the gap.
 *   - A line that has to get PAST other pages (the board to its third page)
 *     climbs in the gap beside where it starts, crosses ABOVE every label row,
 *     and comes back down in the gap beside where it lands. The vertical legs
 *     stay in the gaps and the crossing stays above the text, so there is no
 *     path by which it can run through a word.
 *
 * Lines that skip pages each get their own height and their own lane in the
 * gap they leave from, so several leaving the board at once read as several
 * lines rather than one line that frays.
 */

type Curve = { id: string; d: string; x1: number; y1: number; x2: number; y2: number };

/**
 * One line to draw: to the artboard `id`, from the storefront, or from the
 * artboard `from` when the page is CHAINED on to another. A chained line is
 * the path a buyer takes, page to next page.
 */
export type PageLink = { id: string; from?: string };

/** How far below a card's top edge a line runs straight across a gap (and
 *  where every line arrives): past the corner radius, well clear of the label
 *  row above. */
const ANCHOR_BELOW_TOP = 40;
/** Where the first line that climbs past other pages leaves its card: ABOVE
 *  the straight line leaving the same edge, so the climb never crosses it. */
const CLIMB_ANCHOR_BELOW_TOP = 28;
/** Never closer to a card's top corner than this, however many lines climb. */
const CLIMB_ANCHOR_MIN = 8;
/** The lane spacing, both along a card's edge and across the gap it leaves
 *  from, for lines that climb past other pages. */
const LANE_SPACING = 10;
/** How far into the gap a climbing line turns up (and, mirrored, down). */
const TURN_INSET = 24;
/** How far above the highest label row the first climbing line crosses: a
 *  clear gap, not a line resting on the titles. */
const CLEARANCE = 48;
/** How much higher each further climbing line crosses than the one before. */
const CLEARANCE_STEP = 20;
/** Never higher than this above the label rows: the stage reserves a fixed
 *  band above the cards for the lines (CONNECTOR_ARC_BAND_PX in DesignerCanvas),
 *  and fitting the canvas measures that band, so a line must stay inside it. */
const CLEARANCE_MAX = 180;
/** Corner rounding where a climbing line turns. */
const TURN_RADIUS = 12;

type Box = { left: number; top: number; right: number; bottom: number };

export function PageConnectors({
  stageRef,
  links,
  revision,
}: {
  stageRef: RefObject<HTMLElement | null>;
  /** The pages that are out, in artboard order. */
  links: readonly PageLink[];
  /** Anything that can move either end: block placement, canvas size, which
   *  pages are open. Re-measured whenever this changes. */
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
    const local = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        left: (rect.left - stageRect.left) / scale,
        top: (rect.top - stageRect.top) / scale,
        right: (rect.right - stageRect.left) / scale,
        bottom: (rect.bottom - stageRect.top) / scale,
      };
    };
    const cardOf = (id: string) =>
      stage.querySelector(`[data-artboard-id="${cssEscape(id)}"] [data-artboard-card]`);

    // Everything a line must not cross: every card, and the top of every
    // label row (the artboard's own wrapper starts at its label row; the
    // board's wrapper starts at its device switch).
    const boardBox = local(board);
    const cards: Box[] = [boardBox];
    let labelTop = boardBox.top;
    const boardWrapper = board.parentElement;
    if (boardWrapper) labelTop = Math.min(labelTop, local(boardWrapper).top);
    for (const artboard of stage.querySelectorAll("[data-artboard-id]")) {
      labelTop = Math.min(labelTop, local(artboard).top);
      const card = artboard.querySelector("[data-artboard-card]");
      if (card) cards.push(local(card));
    }

    type Span = { id: string; sourceKey: string; source: Box; target: Box; climbs: boolean };
    const spans: Span[] = [];
    for (const { id, from } of links) {
      const targetCard = cardOf(id);
      const sourceCard = from ? cardOf(from) : board;
      if (!targetCard || !sourceCard) continue;
      const source = local(sourceCard);
      const target = local(targetCard);
      // Anything standing between the two cards?
      const climbs = cards.some(
        (card) =>
          card.left >= source.right - 1 && card.right <= target.left + 1 && card !== source && card !== target,
      );
      spans.push({ id, sourceKey: from ?? "", source, target, climbs });
    }

    // Lines climbing out of the same card NEST rather than cross: links come
    // in artboard order, so the first climber has the nearest target, and it
    // takes the lowest place on the edge, the turn furthest out into the gap
    // and the lowest crossing. Each later one leaves higher, turns up inside
    // it and crosses above it.
    const climbersFrom = new Map<string, number>();
    for (const span of spans) {
      if (span.climbs) climbersFrom.set(span.sourceKey, (climbersFrom.get(span.sourceKey) ?? 0) + 1);
    }
    const lanesUsed = new Map<string, number>();
    let climbing = 0;

    const next: Curve[] = [];
    for (const { id, sourceKey, source, target, climbs } of spans) {
      const x1 = source.right;
      const x2 = target.left;
      const y2 = target.top + ANCHOR_BELOW_TOP;

      if (!climbs) {
        const y1 = source.top + ANCHOR_BELOW_TOP;
        const bend = (x2 - x1) / 2;
        next.push({
          id,
          d: `M ${r(x1)} ${r(y1)} C ${r(x1 + bend)} ${r(y1)}, ${r(x2 - bend)} ${r(y2)}, ${r(x2)} ${r(y2)}`,
          x1,
          y1,
          x2,
          y2,
        });
        continue;
      }

      const lane = lanesUsed.get(sourceKey) ?? 0;
      lanesUsed.set(sourceKey, lane + 1);
      const lanes = climbersFrom.get(sourceKey) ?? 1;
      const y1 = source.top + Math.max(CLIMB_ANCHOR_MIN, CLIMB_ANCHOR_BELOW_TOP - lane * LANE_SPACING);
      const xa = x1 + TURN_INSET + (lanes - 1 - lane) * LANE_SPACING;
      const xb = x2 - TURN_INSET;
      const apex = labelTop - Math.min(CLEARANCE_MAX, CLEARANCE + climbing * CLEARANCE_STEP);
      climbing += 1;
      const k = TURN_RADIUS;
      next.push({
        id,
        d: [
          `M ${r(x1)} ${r(y1)}`,
          `H ${r(xa - k)}`,
          `Q ${r(xa)} ${r(y1)} ${r(xa)} ${r(y1 - k)}`,
          `V ${r(apex + k)}`,
          `Q ${r(xa)} ${r(apex)} ${r(xa + k)} ${r(apex)}`,
          `H ${r(xb - k)}`,
          `Q ${r(xb)} ${r(apex)} ${r(xb)} ${r(apex + k)}`,
          `V ${r(y2 - k)}`,
          `Q ${r(xb)} ${r(y2)} ${r(xb + k)} ${r(y2)}`,
          `H ${r(x2)}`,
        ].join(" "),
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

  // The board's own height changes as tiles move and a page grows as its
  // design changes; both move an end of a line without re-rendering this.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || links.length === 0) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);
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
        <g key={curve.id} opacity={0.45} data-connector={curve.id}>
          <path d={curve.d} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
          <circle cx={curve.x1} cy={curve.y1} r={5} fill="currentColor" />
          <circle cx={curve.x2} cy={curve.y2} r={5} fill="currentColor" />
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

/** CSS.escape, with a fallback for the jsdom builds that lack it. */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}
