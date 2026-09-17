import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Analytics: lucide's "trending-up" glyph, lifted verbatim — the shaft runs
 * northeast, dips southeast, then runs northeast again into the arrowhead.
 *
 * On hover the shaft traces itself from the tail up to the tip, and the
 * arrowhead pops in once the line arrives. The shaft's `d` lists its points
 * tail-first (the reverse of lucide's own top-to-bottom order) because
 * `pathLength` always draws in the direction the path data is written; the
 * geometry itself is untouched.
 */
const SHAFT: Variants = {
  idle: { pathLength: 1, transition: SETTLE },
  hover: {
    pathLength: [0, 1],
    transition: { duration: 0.45, ease: EASE_STANDARD },
  },
};

const HEAD: Variants = {
  idle: { opacity: 1, transition: SETTLE },
  hover: {
    opacity: [0, 1],
    transition: { delay: 0.36, duration: 0.14, ease: EASE_ENTRANCE },
  },
};

export function AnalyticsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <motion.path variants={SHAFT} d="M2 17 8.5 10.5 13.5 15.5 22 7" />
      <motion.path variants={HEAD} d="M16 7h6v6" />
    </IconSvg>
  );
}
