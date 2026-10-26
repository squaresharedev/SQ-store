import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Discounts: lucide's price tag, and nothing else. At rest it is the plain
 * static glyph; on hover the tag jiggles around its punch hole in decaying
 * passes and settles.
 *
 * The swing is motion-blurred: a few faint copies of the outline follow the
 * tag a hair behind, so its edges smear along the arc while it is moving and
 * collapse back onto the tag whenever it is nearly still. The copies sit at
 * zero opacity at rest, so the resting glyph is the tag alone.
 */
const TAG =
  "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z";

/** The swing, in degrees: decaying passes either side of rest. */
const JIGGLE = [0, -14, 12, -9, 6, -3, 0];
const JIGGLE_DURATION = 0.6;

/**
 * The punch hole, as a fraction of the tag's own bounds (it spans 2 to 22 on
 * both axes, the hole sits at 7.5): the jiggle pivots here, like a tag
 * hanging from its string.
 */
const HOLE = (7.5 - 2) / 20;
const PIVOT = { originX: HOLE, originY: HOLE };

const TAG_JIGGLE: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: JIGGLE,
    transition: { duration: JIGGLE_DURATION, ease: EASE_STANDARD },
  },
};

/**
 * The same swing, started a little late. Opacity fades in at the start and
 * out at the end (evenly spaced keyframes: plain opacity runs on the browser's
 * animation engine, which ignores a custom `times` array).
 */
function blurCopy(lag: number, opacity: number): Variants {
  return {
    idle: { rotate: 0, opacity: 0, transition: SETTLE },
    hover: {
      rotate: JIGGLE,
      opacity: [0, opacity, opacity, opacity, opacity, opacity, 0],
      transition: {
        delay: lag,
        duration: JIGGLE_DURATION,
        ease: EASE_STANDARD,
      },
    },
  };
}

/** Each blur copy: how far (seconds) it trails the tag, and how faint it is. */
const BLUR_COPIES = [
  { lag: 0.008, opacity: 0.32 },
  { lag: 0.016, opacity: 0.24 },
  { lag: 0.024, opacity: 0.16 },
  { lag: 0.032, opacity: 0.08 },
].map(({ lag, opacity }) => ({ lag, variants: blurCopy(lag, opacity) }));

export function DiscountsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      {/* Opacity 0 on the element itself, not just in the idle variant, so the
          resting glyph is the plain tag even where no variant label ever
          reaches the copies (reduced motion). */}
      {BLUR_COPIES.map(({ lag, variants }) => (
        <motion.path
          key={lag}
          variants={variants}
          d={TAG}
          opacity={0}
          style={PIVOT}
        />
      ))}
      <motion.g variants={TAG_JIGGLE} style={PIVOT}>
        <path d={TAG} />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </motion.g>
    </IconSvg>
  );
}
