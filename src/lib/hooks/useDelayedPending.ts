"use client";

import { useEffect, useRef, useState } from "react";
import { PENDING_DELAY_MS, PENDING_MIN_SHOW_MS } from "@/components/ui/motion-tokens";

/**
 * Whether to SHOW a loading state for work that is `pending`: only once it has
 * outlasted PENDING_DELAY_MS, and then for at least PENDING_MIN_SHOW_MS.
 *
 * Callers keep their own "pending" for logic (ignore a second click, lock the
 * form) and use this only for what the seller sees. A click that finishes in
 * a blink never flashes a spinner, and one that takes a while always gets one.
 *
 * State is written only from timer callbacks, never synchronously in an
 * effect, so it stays off React's cascading-render path.
 */
export function useDelayedPending(
  pending: boolean,
  delayMs: number = PENDING_DELAY_MS,
  minShowMs: number = PENDING_MIN_SHOW_MS,
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (pending) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }
    // Settled: leave once the minimum has passed (at once if nothing showed).
    const shownFor = shownAt.current === null ? minShowMs : Date.now() - shownAt.current;
    const timer = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, Math.max(0, minShowMs - shownFor));
    return () => clearTimeout(timer);
  }, [pending, delayMs, minShowMs]);

  return visible;
}
