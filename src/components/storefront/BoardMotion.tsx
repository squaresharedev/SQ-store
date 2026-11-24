"use client";

import { useEffect, useRef } from "react";
import type { MotionPreset } from "@/types/storefront";
import { startBoardReveal } from "@/lib/storefront/board-reveal";
import { boardMotion } from "@/lib/storefront/motion";

/**
 * HOW A BUYER'S BOARD ARRIVES (theme.motion), placed by StorefrontBoard just
 * before its grid. Buyers' pages and the embed frame only: the designer's
 * canvas never renders it, so the board being built stands still.
 *
 * Renders one hidden anchor carrying the preset. The first-paint arrival is
 * pure CSS scoped by it (globals.css, "motion and finish"), so it plays with
 * no script and always ends visible; this component then hands the cells to
 * the scroll reveal (lib/storefront/board-reveal), which hides a block only
 * once the observer has reported it off screen.
 *
 * ABSENT (or `none`) renders nothing at all: a storefront saved before motion
 * existed gets the same DOM it always had.
 */
export function BoardMotion({ motion }: { motion?: MotionPreset }) {
  const preset = boardMotion({ motion });
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const scope = anchorRef.current?.parentElement;
    if (!preset || !scope) return;
    return startBoardReveal(scope, preset);
  }, [preset]);

  if (!preset) return null;
  // data-board-motion: BOARD_MOTION_ATTRIBUTE, spelled out so JSX can type it.
  return <span ref={anchorRef} hidden data-board-motion={preset} />;
}
