import { useId } from "react";
import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Discounts: a percent badge. On hover the % scrolls up out of it, a price tag
 * rolls in from below and swings from its hole; leaving rolls it all back.
 *
 * Geometry is lucide's badge-percent, so at rest it is the static glyph. The
 * roll is clipped to the badge so nothing shows outside its edge.
 */
const BADGE =
  "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z";

const PERCENT_OUT: Variants = {
  idle: { y: 0, transition: SETTLE },
  hover: { y: -18, transition: { duration: 0.35, ease: EASE_STANDARD } },
};

const TAG_IN: Variants = {
  idle: { y: 18, transition: SETTLE },
  hover: {
    y: [18, -1.5, 0],
    transition: { delay: 0.12, duration: 0.4, ease: EASE_ENTRANCE },
  },
};

/** Once the tag has landed it swings from its hole in decaying passes. */
const TAG_SWING: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: [0, -24, 14, -6, 0],
    transition: { delay: 0.38, duration: 0.65, ease: EASE_STANDARD },
  },
};

export function DiscountsIcon({ className }: NavIconProps) {
  // Per instance: the rail and a gallery can both draw it, and a clip defined
  // inside a hidden copy would not apply to the visible one.
  const clipId = useId();
  return (
    <IconSvg className={className}>
      <defs>
        <clipPath id={clipId}>
          <path d={BADGE} />
        </clipPath>
      </defs>
      <path d={BADGE} />
      <g clipPath={`url(#${clipId})`}>
        <motion.g variants={PERCENT_OUT}>
          <path d="M9 9h.01" />
          <path d="m15 9-6 6" />
          <path d="M15 15h.01" />
        </motion.g>
        <motion.g variants={TAG_IN}>
          <motion.g variants={TAG_SWING} style={{ originX: 0.3, originY: 0.3 }}>
            <path d="M8 8h4l5 5-4 4-5-5z" />
            <path d="M10 10h.01" />
          </motion.g>
        </motion.g>
      </g>
    </IconSvg>
  );
}
