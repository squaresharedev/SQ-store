import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Products: the lid opens and a few items peek out from inside.
 *
 * Only the two long lids (hinged on the front-left and back-right rim edges)
 * move; they're the pair whose closed shape traces lucide's own crease lines,
 * so the resting glyph is unchanged. A lid turning out of that plane keeps
 * its free edge parallel to its hinge, so the offset from hinge to free edge
 * is cos(angle) across the lid plus sin(angle) straight up.
 *
 * The swing is a 3-keyframe arc (closed, near-vertical peak, open), not a
 * straight tween between the two end shapes: Motion interpolates the `d`
 * string point-by-point, so two keyframes cut the hinge's arc into a
 * straight-line morph. A keyframe at the midpoint angle traces the curve a
 * real lid actually swings through.
 */
const ALONG_SEAM = { x: 4.355, y: -2.5 };
const RISE = 5;
const PEAK_ANGLE = 82;
const OPEN_ANGLE = 148;

type Point = { x: number; y: number };
type Lid = { hinge: [Point, Point]; side: 1 | -1 };
const P = (x: number, y: number): Point => ({ x, y });

const LIDS: Lid[] = [
  { hinge: [P(12, 12), P(3.29, 7)], side: 1 }, // front-left
  { hinge: [P(12, 2), P(20.71, 7)], side: -1 }, // back-right
];

function lidPath({ hinge, side }: Lid, degrees: number): string {
  const [a, b] = hinge;
  const radians = (degrees * Math.PI) / 180;
  const offset = {
    x: Math.cos(radians) * ALONG_SEAM.x * side,
    y: Math.cos(radians) * ALONG_SEAM.y * side - Math.sin(radians) * RISE,
  };
  const corner = (p: Point) =>
    `${(p.x + offset.x).toFixed(2)} ${(p.y + offset.y).toFixed(2)}`;
  return `M${a.x} ${a.y}L${b.x} ${b.y}L${corner(b)}L${corner(a)}Z`;
}

const SWING = { duration: 0.46, times: [0, 0.45, 1], ease: EASE_ENTRANCE };

const LID_VARIANTS: Variants[] = LIDS.map((lid) => ({
  idle: { d: lidPath(lid, 0), transition: SETTLE },
  hover: {
    d: [lidPath(lid, 0), lidPath(lid, PEAK_ANGLE), lidPath(lid, OPEN_ANGLE)],
    transition: SWING,
  },
}));

/**
 * Items peeking out: two solid dots sitting inside the box, hidden below the
 * rim, one under each face. At the icon's real render size (a nav row is
 * ~20px), anything smaller than this reads as noise or vanishes outright —
 * a dot has to be a meaningful fraction of the glyph itself to survive
 * antialiasing at that size, which is why these look large relative to the
 * box in an enlarged inspector view. Sized and judged at native size, not
 * the zoomed preview.
 *
 * Each rises and fades in once the lid has started to part, staggered so
 * they don't both surface at once, with a small overshoot on the way up so
 * the stop reads as landing rather than just stopping.
 */
type Item = { cx: number; cy: number; r: number; rise: number; delay: number };

const ITEMS: Item[] = [
  { cx: 7.8, cy: 16.25, r: 3.4, rise: 4.25, delay: 0.06 },
  { cx: 16.2, cy: 16.25, r: 3.4, rise: 4.25, delay: 0.14 },
];

function itemVariants(rise: number, delay: number): Variants {
  return {
    idle: { y: 0, opacity: 0, scale: 0.5, transition: SETTLE },
    hover: {
      y: [0, -rise * 1.08, -rise],
      opacity: [0, 1, 1],
      scale: [0.5, 1.05, 1],
      transition: {
        duration: 0.42,
        times: [0, 0.7, 1],
        delay,
        ease: EASE_ENTRANCE,
      },
    },
  };
}

export function ProductsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
      <path d="M12 22V12" />
      <polyline points="3.29 7 12 12 20.71 7" />

      {LIDS.map((lid, i) => (
        <motion.path key={i} variants={LID_VARIANTS[i]} d={lidPath(lid, 0)} />
      ))}

      {ITEMS.map(({ cx, cy, r, rise, delay }, i) => (
        <motion.circle
          key={i}
          variants={itemVariants(rise, delay)}
          cx={cx}
          cy={cy}
          r={r}
          fill="currentColor"
          stroke="none"
        />
      ))}
    </IconSvg>
  );
}
