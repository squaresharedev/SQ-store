import { useId } from "react";
import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import {
  EASE_ENTRANCE,
  EASE_EXIT,
  EASE_STANDARD,
  SETTLE,
} from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Analytics: lucide's "trending-up" glyph takes off. The arrow picks up speed
 * up its own slope and shoots out of the top-right corner, then rises back in
 * from the bottom and lands where it started, with wind tearing back down the
 * slope behind it as it goes.
 *
 * The arrow is clipped to the icon box so it really leaves. Between leaving
 * and coming back it travels round the outside of the box (right, then down,
 * then left underneath), so no frame of the hand-over ever draws it inside.
 *
 * Streaks sit at zero opacity at rest, so the icon is untouched until hover.
 * Their keyframes are evenly spaced on purpose: motion runs plain opacity on
 * the browser's animation engine and transforms on its own, and only the
 * latter honours a custom `times` array, so a streak with custom timing would
 * fade out of step with its own flight.
 */
const ARROW_LOOP: Variants = {
  idle: { x: 0, y: 0, transition: SETTLE },
  hover: {
    // rest -> gone top-right -> round the outside -> below -> up -> settle
    x: [0, 20, 26, 26, 0, 0, 0],
    y: [0, -20, -20, 26, 26, -1, 0],
    transition: {
      duration: 1,
      times: [0, 0.32, 0.34, 0.36, 0.42, 0.82, 1],
      ease: [
        EASE_EXIT,
        "linear",
        "linear",
        "linear",
        EASE_ENTRANCE,
        EASE_STANDARD,
      ],
    },
  },
};

/** One gust trailing down the slope, timed to the arrow's take-off. */
function streak(delay: number, distance: number): Variants {
  return {
    idle: { x: 0, y: 0, opacity: 0, transition: { duration: 0.1 } },
    hover: {
      x: [0, -distance * 0.4, -distance],
      y: [0, distance * 0.4, distance],
      opacity: [0, 0.95, 0],
      transition: { delay, duration: 0.32, ease: EASE_ENTRANCE },
    },
  };
}

/** A streak lying along the arrow's slope, trailing down and to the left. */
const dash = (x: number, y: number, length = 1.7) =>
  `M${x} ${y}l-${length} ${length}`;

const STREAKS: Array<{ d: string; variants: Variants }> = [
  { d: dash(22.5, 11.5), variants: streak(0.08, 7) },
  { d: dash(21, 15, 2.1), variants: streak(0.12, 8) },
  { d: dash(12, 3, 2.1), variants: streak(0.14, 8) },
  { d: dash(23, 16), variants: streak(0.18, 7) },
  { d: dash(8.5, 5.5), variants: streak(0.2, 7) },
  { d: dash(18.5, 16), variants: streak(0.24, 7) },
];

export function AnalyticsIcon({ className }: NavIconProps) {
  // Per instance: the rail and a gallery can both draw it, and a clip defined
  // inside a hidden copy would not apply to the visible one.
  const clipId = useId();
  return (
    <IconSvg className={className}>
      <defs>
        <clipPath id={clipId}>
          <rect width="24" height="24" />
        </clipPath>
      </defs>

      {/* Opacity 0 on the element itself, not just in the idle variant, so the
          resting glyph is the plain lucide arrow even where no variant label
          ever reaches the streaks (reduced motion). */}
      {STREAKS.map(({ d, variants }, i) => (
        <motion.path key={i} variants={variants} d={d} opacity={0} />
      ))}

      <g clipPath={`url(#${clipId})`}>
        <motion.g variants={ARROW_LOOP}>
          <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
          <path d="M16 7h6v6" />
        </motion.g>
      </g>
    </IconSvg>
  );
}
