"use client";

import { useReducedMotion } from "motion/react";

/**
 * Props for the CONTROL that owns an animated action icon (the button, not the
 * glyph). Switching the variant label here propagates "hover" down through the
 * plain <svg> to the icon's motion sub-elements, so the whole button is the
 * trigger rather than the 16px of artwork inside it.
 *
 * Tap covers touch, focus covers keyboards. Reduced-motion users never receive
 * the label at all, so the icon simply stays in its lucide-identical rest pose
 * instead of animating into place faster.
 */
export function useIconHoverProps(): {
  initial: "idle";
  whileHover?: "hover";
  whileTap?: "hover";
  whileFocus?: "hover";
} {
  const reducedMotion = useReducedMotion();
  return reducedMotion
    ? { initial: "idle" }
    : {
        initial: "idle",
        whileHover: "hover",
        whileTap: "hover",
        whileFocus: "hover",
      };
}
