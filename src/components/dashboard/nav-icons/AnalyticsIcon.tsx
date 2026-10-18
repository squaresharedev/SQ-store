import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Analytics: lucide's "trending-up" glyph takes off without going anywhere.
 *
 * Like the Orders cart, the arrow itself only leans a fraction of a unit up
 * its slope and comes back. The speed is carried by the wind: streaks tear
 * back down the arrow's own 45 degrees, in the empty corners either side of
 * the line, thick and fast at the start, then fewer and slower until they
 * stop, so the climb ends by levelling off rather than cutting out.
 *
 * Streaks sit at zero opacity at rest, so the icon is untouched until hover.
 * Their keyframes are evenly spaced on purpose: motion runs plain opacity on
 * the browser's animation engine and transforms on its own, and only the
 * latter honours a custom `times` array, so a streak with custom timing would
 * fade out of step with its own flight.
 */
const ARROW_SURGE: Variants = {
  idle: { x: 0, y: 0, transition: SETTLE },
  hover: {
    x: [0, 1.2, -0.5, 0.2, 0],
    y: [0, -1.2, 0.5, -0.2, 0],
    transition: { duration: 1.05, ease: EASE_STANDARD },
  },
};

function streakVariants(
  delay: number,
  distance: number,
  duration: number,
  ease: [number, number, number, number],
): Variants {
  return {
    idle: { x: 0, y: 0, opacity: 0, transition: { duration: 0.1 } },
    hover: {
      x: [0, -distance * 0.4, -distance],
      y: [0, distance * 0.4, distance],
      opacity: [0, 0.95, 0],
      transition: { delay, duration, ease },
    },
  };
}

// Three bands, each later, shorter and slower than the last, so the wind
// thins out continuously instead of stopping and starting again.
/** Flat out: both flanks streaming at once, hard and fast. */
const fast = (delay: number, distance: number) =>
  streakVariants(delay, distance, 0.32, EASE_ENTRANCE);

/** Easing off. */
const medium = (delay: number, distance: number) =>
  streakVariants(delay, distance, 0.4, EASE_ENTRANCE);

/** Levelling off: the last few, barely moving. */
const slow = (delay: number, distance: number) =>
  streakVariants(delay, distance, 0.5, EASE_STANDARD);

/** A streak lying along the arrow's slope, trailing down and to the left. */
const dash = (x: number, y: number, length = 1.7) =>
  `M${x} ${y}l-${length} ${length}`;

const STREAKS: Array<{ d: string; variants: Variants }> = [
  { d: dash(22.5, 11.5), variants: fast(0, 7) },
  { d: dash(21, 15, 2.1), variants: fast(0.05, 8) },
  { d: dash(23, 16), variants: fast(0.02, 7) },
  { d: dash(12, 3, 2.1), variants: fast(0.08, 8) },
  { d: dash(8.5, 5.5), variants: fast(0.13, 7) },
  { d: dash(18.5, 16), variants: fast(0.16, 7) },
  { d: dash(22.5, 11.5), variants: medium(0.22, 6) },
  { d: dash(12, 3, 2.1), variants: medium(0.27, 5) },
  { d: dash(21, 15, 2.1), variants: medium(0.33, 5) },
  { d: dash(8.5, 5.5), variants: slow(0.45, 4) },
  { d: dash(23, 16), variants: slow(0.53, 3.5) },
  { d: dash(18.5, 16), variants: slow(0.6, 3) },
];

export function AnalyticsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      {/* Opacity 0 on the element itself, not just in the idle variant, so the
          resting glyph is the plain lucide arrow even where no variant label
          ever reaches the streaks (reduced motion). */}
      {STREAKS.map(({ d, variants }, i) => (
        <motion.path key={i} variants={variants} d={d} opacity={0} />
      ))}

      <motion.g variants={ARROW_SURGE}>
        <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
        <path d="M16 7h6v6" />
      </motion.g>
    </IconSvg>
  );
}
