"use client";

import { useState, type RefObject } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";

/**
 * The largest size in `[floor, ceiling]` for which `fits` says yes, found by
 * binary search. Pulled out of the hook below so the shrink arithmetic can be
 * pinned in a plain unit test — jsdom has no layout, so a `fits` built on real
 * measurements always reports true and never exercises this at all.
 *
 * `fits` only has to be monotonic — true down to some threshold, false past
 * it — which is all a "does this much text fit in this much box" check ever
 * is: shrinking a font never makes it need MORE room.
 */
export function resolveAutoFitSize(
  ceiling: number,
  floor: number,
  fits: (px: number) => boolean,
): number {
  if (fits(ceiling)) return ceiling;
  let lo = floor;
  let hi = ceiling;
  // Half a pixel is finer than the rounding at the end can even keep, so a
  // fixed handful of steps is always enough regardless of the starting range.
  for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  let resolved = Math.round(fits(lo) ? lo : floor);
  // Rounding can round UP past the last size the search actually verified —
  // the fractional value it converged on fit, but the integer above it was
  // never tested and may not. Step back down until the INTEGER itself fits,
  // so shrinking is never the one case that still overflows the box.
  while (resolved > floor && !fits(resolved)) resolved -= 1;
  return resolved;
}

/** A container's inner height once its own padding is taken back out — the
 *  room its content actually has, which clientHeight alone still counts. */
function availableHeight(container: HTMLElement): number {
  const style = getComputedStyle(container);
  const paddingY =
    parseFloat(style.paddingTop || "0") + parseFloat(style.paddingBottom || "0");
  return container.clientHeight - paddingY;
}

/**
 * Shrinks a text block's rendered size, in the absence of a seller-chosen
 * override, until its lines fit inside the tile that holds them — so a
 * paragraph typed into a small box gets smaller type instead of being
 * silently clipped by the tile's own overflow:hidden. Skipped entirely once
 * `enabled` is false: an explicit size is the seller's own choice, cropped or
 * not, and is never shrunk out from under them.
 *
 * Runs in a layout effect so a keystroke that needs to shrink the text lands
 * before the browser paints, and re-measures on every resize of the
 * container (the seller dragging the tile's own handle, or a responsive
 * reflow) — not just on content change, since the same words can stop or
 * start fitting as the box around them changes size.
 */
export function useAutoFitTextSize({
  containerRef,
  textRef,
  ceiling,
  floor,
  enabled,
  deps,
}: {
  /** The box the text has to fit inside — measured net of ITS OWN padding. */
  containerRef: RefObject<HTMLElement | null>;
  /** The element actually holding the words, sized directly. */
  textRef: RefObject<HTMLElement | null>;
  /** The largest size to try — the variant's own scale. Auto only ever
   *  shrinks below what the style calls for, never grows past it. */
  ceiling: number;
  /** Never shrink smaller than a seller could dial in by hand. */
  floor: number;
  enabled: boolean;
  /** Everything besides a resize that can change how much room the text
   *  needs: its words, its per-run formatting, and anything that changes its
   *  metrics (weight, family, alignment). */
  deps: readonly unknown[];
}): number {
  const [size, setSize] = useState(ceiling);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    function fits(px: number): boolean {
      text!.style.fontSize = `${px}px`;
      return (
        text!.scrollHeight <= availableHeight(container!) + 0.5 &&
        // Wrapping keeps this from ever binding in the ordinary case; it only
        // catches one unbroken run (a long URL, say) with nowhere to wrap.
        text!.scrollWidth <= text!.clientWidth + 0.5
      );
    }

    function measure() {
      const resolved = resolveAutoFitSize(ceiling, floor, fits);
      // Restated even when unchanged: the search above can leave the node's
      // own style at whatever candidate it tried last.
      text!.style.fontSize = `${resolved}px`;
      setSize((current) => (current === resolved ? current : resolved));
    }

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled, ceiling, floor, containerRef, textRef, ...deps]);

  return size;
}
