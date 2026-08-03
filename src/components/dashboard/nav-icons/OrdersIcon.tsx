import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Orders: the cart tears along without going anywhere.
 *
 * The cart itself only leans and surges a fraction of a unit. The speed is
 * carried entirely by the wind: streaks tear past the whole left flank, dense
 * and fast at the start, then fewer and slower until they stop altogether, so
 * the run ends by coasting to a halt rather than cutting out.
 *
 * Streaks sit at zero opacity at rest, so the icon is untouched until hover.
 * Their keyframes are evenly spaced on purpose: motion runs plain opacity on
 * the browser's animation engine and transforms on its own, and only the
 * latter honours a custom `times` array, so a streak with custom timing would
 * fade out of step with its own flight.
 */
const CART_SURGE: Variants = {
  idle: { x: 0, rotate: 0, transition: SETTLE },
  hover: {
    x: [0, -0.7, 0.7, 0.3, 0],
    rotate: [0, -1.5, 1, 0.4, 0],
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
    idle: { x: 0, opacity: 0, transition: { duration: 0.1 } },
    hover: {
      x: [0, -distance * 0.4, -distance],
      opacity: [0, 0.95, 0],
      transition: { delay, duration, ease },
    },
  };
}

// Three bands, each later, shorter and slower than the last, so the wind
// thins out continuously instead of stopping and starting again.
/** Flat out: the whole flank streaming at once, hard and fast. */
const fast = (delay: number, distance: number) =>
  streakVariants(delay, distance, 0.32, EASE_ENTRANCE);

/** Easing off. */
const medium = (delay: number, distance: number) =>
  streakVariants(delay, distance, 0.4, EASE_ENTRANCE);

/** Coasting: the last few, barely moving. */
const slow = (delay: number, distance: number) =>
  streakVariants(delay, distance, 0.5, EASE_STANDARD);

const STREAKS: Array<{ d: string; variants: Variants }> = [
  { d: "M5 3.5h-2.5", variants: fast(0, 11) },
  { d: "M4.5 6h-3", variants: fast(0.05, 12) },
  { d: "M4.2 9h-2.2", variants: fast(0.02, 10) },
  { d: "M4.6 12h-3", variants: fast(0.09, 12) },
  { d: "M4.2 15h-2.4", variants: fast(0.14, 11) },
  { d: "M5 18h-2.6", variants: fast(0.07, 10) },
  { d: "M6.5 21h-2.6", variants: fast(0.17, 11) },
  { d: "M5 3.5h-2.5", variants: medium(0.24, 9) },
  { d: "M4.2 9h-2.2", variants: medium(0.2, 8) },
  { d: "M4.2 15h-2.4", variants: medium(0.3, 8) },
  { d: "M6.5 21h-2.6", variants: medium(0.34, 7) },
  { d: "M4.5 6h-3", variants: slow(0.46, 6) },
  { d: "M4.6 12h-3", variants: slow(0.54, 5) },
  { d: "M5 18h-2.6", variants: slow(0.62, 4) },
];

export function OrdersIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      {STREAKS.map(({ d, variants }, i) => (
        <motion.path key={i} variants={variants} d={d} />
      ))}

      <motion.g variants={CART_SURGE}>
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </motion.g>
    </IconSvg>
  );
}
