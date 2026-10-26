import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Discounts: a percent badge. On hover the badge shrinks away and the price
 * tag (label) pops up in its place and jiggles; leaving swaps them back.
 *
 * Geometry is lucide's badge-percent at rest and lucide's tag on hover, so
 * each end of the story is the static glyph.
 */
const BADGE_OUT: Variants = {
  idle: { scale: 1, opacity: 1, transition: SETTLE },
  hover: {
    scale: 0.5,
    opacity: 0,
    transition: { duration: 0.15, ease: EASE_STANDARD },
  },
};

const TAG_IN: Variants = {
  idle: { scale: 0.5, opacity: 0, transition: SETTLE },
  hover: {
    scale: 1,
    opacity: 1,
    transition: { delay: 0.08, duration: 0.22, ease: EASE_ENTRANCE },
  },
};

/** Once it has landed the tag wobbles side to side in decaying passes. */
const TAG_JIGGLE: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: [0, -14, 12, -9, 6, -3, 0],
    transition: { delay: 0.2, duration: 0.6, ease: EASE_STANDARD },
  },
};

export function DiscountsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <motion.g variants={BADGE_OUT} style={{ originX: 0.5, originY: 0.5 }}>
        <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
        <path d="M9 9h.01" />
        <path d="m15 9-6 6" />
        <path d="M15 15h.01" />
      </motion.g>
      {/* Opacity 0 on the element itself, not just in the idle variant, so the
          resting glyph is the plain badge even where no variant label ever
          reaches the tag (reduced motion). */}
      <motion.g
        variants={TAG_IN}
        opacity={0}
        style={{ originX: 0.5, originY: 0.5 }}
      >
        <motion.g variants={TAG_JIGGLE} style={{ originX: 0.5, originY: 0.5 }}>
          <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
          <path d="M7.5 7.5h.01" />
        </motion.g>
      </motion.g>
    </IconSvg>
  );
}
