"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  tooltipArrowClass,
  tooltipArrowDownClass,
  tooltipArrowUpClass,
} from "@/components/ui/control-styles";

/**
 * WHERE A TOOLTIP GOES, for both floating tips in the product (the "?" InfoTip
 * and the hover-label Tooltip).
 *
 * Shared rather than written twice because the two bubbles must agree about
 * every rule below — a "?" that flips above its trigger next to a hover label
 * that runs off the bottom of the screen is not one tooltip system, it is two.
 *
 * Both bubbles are `position: fixed` in a portal on <body>. An absolutely
 * positioned tip is clipped the moment it is used inside anything that scrolls
 * (the storefront designer's side panel, a table), and these are meant to be
 * safe everywhere.
 */

/** Gap between trigger and bubble, and the room kept against the viewport. */
const GAP = 8;
const EDGE = 8;
/** The point is an 8px square turned 45°, sunk half its size into the edge. */
export const TIP_ARROW = 8;

export type TipPlacement = {
  top: number;
  left: number;
  /** Which side of the TRIGGER the bubble took. "bottom" is the default (the
   *  bubble hangs below, point on top); "top" means it flipped. */
  side: "top" | "bottom";
  /** Where the point sits along the bubble's own width, in px from its left. */
  arrowLeft: number;
};

/**
 * Place `bubbleRef` against `triggerRef` while `open`.
 *
 * Runs AFTER the bubble is in the DOM: its measured size decides the
 * horizontal clamp and whether it flips above the trigger. Returns null until
 * that first measuring pass has happened, which is the caller's cue to render
 * the bubble hidden in the corner for one frame.
 *
 * The last placement is deliberately NOT cleared on close, so a second open
 * reuses it for its own pre-paint frame instead of flashing in the corner.
 */
export function useTipPlacement(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  bubbleRef: React.RefObject<HTMLElement | null>,
): TipPlacement | null {
  const [placement, setPlacement] = React.useState<TipPlacement | null>(null);
  // Bumped every animation frame while open, so the placement below re-runs
  // and the bubble stays glued to its trigger. Scroll and resize events alone
  // are not enough: the storefront canvas pans and zooms by writing a CSS
  // transform straight to the stage element every frame (see
  // useCanvasViewport), with no scroll or resize event at all — a trigger
  // riding that transform would otherwise leave its tooltip stranded at the
  // spot it opened at. Re-measuring every frame catches that transform along
  // with anything else that moves a trigger without dispatching either event.
  const [reflow, setReflow] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let frame = requestAnimationFrame(function tick() {
      setReflow((n) => n + 1);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const rect = trigger.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;

    const left = Math.max(
      EDGE,
      Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - EDGE,
      ),
    );
    const below = rect.bottom + GAP;
    const flip =
      below + height > window.innerHeight - EDGE &&
      rect.top - GAP - height >= EDGE;
    const top = flip ? rect.top - GAP - height : below;
    // The point aims at the trigger's centre, but is never allowed past the
    // bubble's own rounded corners — a point growing out of a curve reads as
    // a rendering fault rather than an arrow.
    const arrowLeft = Math.max(
      TIP_ARROW,
      Math.min(
        rect.left + rect.width / 2 - left - TIP_ARROW / 2,
        Math.max(TIP_ARROW, width - TIP_ARROW * 2),
      ),
    );
    const side = flip ? "top" : "bottom";

    // Bail when nothing moved. A tooltip's content is a fresh ReactNode every
    // render, so this effect must never be the thing that causes the next one.
    setPlacement((prev) =>
      prev &&
      prev.top === top &&
      prev.left === left &&
      prev.side === side &&
      prev.arrowLeft === arrowLeft
        ? prev
        : { top, left, side, arrowLeft },
    );
  }, [open, reflow, triggerRef, bubbleRef]);

  return placement;
}

/** Inline style for the bubble itself. The very first open is a measuring
 *  pass: rendered off in the corner and hidden, then placed by the layout
 *  effect before the browser paints, so it never appears in the wrong spot. */
export function tipBubbleStyle(
  placement: TipPlacement | null,
): React.CSSProperties {
  return placement
    ? { top: placement.top, left: placement.left }
    : { top: 0, left: 0, visibility: "hidden" };
}

/** The point, as the bubble's last child. Purely decorative, so it stays out
 *  of the accessibility tree entirely. */
export function TipArrow({ placement }: { placement: TipPlacement | null }) {
  if (!placement) return null;
  const up = placement.side === "bottom";
  return (
    <span
      aria-hidden="true"
      style={{
        left: placement.arrowLeft,
        ...(up ? { top: -TIP_ARROW / 2 } : { bottom: -TIP_ARROW / 2 }),
      }}
      className={cn(
        tooltipArrowClass,
        up ? tooltipArrowUpClass : tooltipArrowDownClass,
      )}
    />
  );
}
