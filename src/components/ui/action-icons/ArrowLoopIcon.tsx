"use client";

import { useRef, type RefObject } from "react";
import { ArrowUpRight } from "lucide-react";
import { useAnimate, useReducedMotion } from "motion/react";
import { DURATION, EASE_ENTRANCE } from "@/components/ui/motion-tokens";
import { cn } from "@/lib/utils";

/**
 * Arrow loop: an up-right arrow leaves through the top-right corner while a
 * fresh copy comes in from the bottom-left to take its place.
 *
 * A one-shot that never rewinds. The two arrows are identical, so once a loop
 * lands they can swap places unseen, and the next one starts from rest again;
 * leaving mid-loop lets it finish rather than flying the arrow back. A hover
 * that arrives while a loop is still running is ignored for the same reason.
 *
 * Distances are a share of the arrow's own size (150% clears a box twice its
 * size), so draw it inside something that clips: the chip's round disc.
 */
const FAR = "150%";
const OUT = { x: [0, FAR], y: [0, `-${FAR}`] };
const IN = { x: [`-${FAR}`, 0], y: [FAR, 0] };
const LOOP = { duration: DURATION.slow, ease: EASE_ENTRANCE };
/** Where the incoming arrow waits, out of sight. A transform (not Tailwind's
 *  translate-*, which sets the separate `translate` property) so the loop's
 *  own transform replaces it instead of stacking on top. */
const WAITING = { transform: `translateX(-${FAR}) translateY(${FAR})` };

/**
 * The loop's trigger, for the CONTROL that owns the arrow (the link, not the
 * glyph): pass the scope to ArrowLoopIcon and call play on hover and keyboard
 * focus. Reduced-motion users get a still arrow.
 */
export function useArrowLoop(): [RefObject<HTMLSpanElement | null>, () => void] {
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const reducedMotion = useReducedMotion();
  const running = useRef(false);

  const play = async () => {
    if (running.current || reducedMotion || !scope.current) return;
    running.current = true;
    try {
      await Promise.all([animate("[data-loop=out]", OUT, LOOP), animate("[data-loop=in]", IN, LOOP)]);
    } finally {
      running.current = false;
    }
  };

  return [scope, play];
}

export function ArrowLoopIcon({
  scope,
  className,
  strokeWidth = 2,
}: {
  scope: RefObject<HTMLSpanElement | null>;
  className?: string;
  strokeWidth?: number;
}) {
  const arrow = "absolute inset-0 size-full";
  return (
    <span ref={scope} aria-hidden className={cn("relative size-4 shrink-0", className)}>
      <ArrowUpRight data-loop="out" strokeWidth={strokeWidth} className={arrow} />
      <ArrowUpRight data-loop="in" strokeWidth={strokeWidth} className={arrow} style={WAITING} />
    </span>
  );
}
