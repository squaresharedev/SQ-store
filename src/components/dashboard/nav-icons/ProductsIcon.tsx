import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Products: the single box shrinks into the first slot of a 2x2 stack, its
 * crease lines fading as it goes, then three more box silhouettes slide in
 * from off-canvas to fill the rest — inventory arriving, not a lid trick.
 *
 * The three arrivals are silhouette-only, the hexagon with no crease lines:
 * at quarter size a full three-path glyph turns to mush, but a clean outline
 * still reads as "a box" at that scale.
 *
 * Every copy shares the same pivot, (12, 12), the hexagon's own natural
 * center, via an explicit pixel transform-origin rather than the group's
 * bounding-box center. The vertical spine path (12,12 to 12,22) pulls that
 * bbox down and off-center, so scaling around it would throw off every slot
 * position computed relative to (12, 12).
 */
const HEXAGON_D =
  "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z";

const CENTER = 12;
// getBBox() on the hexagon path measures 18 wide (x: 3-21) by 20 tall
// (y: 2-22): far taller than it looks at a glance, since the top and bottom
// corners come to a point past the crease lines that dominate the
// silhouette. Slot spacing is sized off that measured footprint, not the
// visual impression of it — an earlier pass eyeballed the height from the
// path string and got it wrong by nearly 2x, which put opposite rows
// overlapping instead of gapped.
const SLOT_SCALE = 0.45;
const HALF_W = (18 * SLOT_SCALE) / 2;
const HALF_H = (20 * SLOT_SCALE) / 2;
const GAP = 1.5;
const SLOTS = {
  topLeft: { x: CENTER - (HALF_W + GAP / 2), y: CENTER - (HALF_H + GAP / 2) },
  topRight: { x: CENTER + (HALF_W + GAP / 2), y: CENTER - (HALF_H + GAP / 2) },
  bottomLeft: { x: CENTER - (HALF_W + GAP / 2), y: CENTER + (HALF_H + GAP / 2) },
  bottomRight: { x: CENTER + (HALF_W + GAP / 2), y: CENTER + (HALF_H + GAP / 2) },
};

const ARRIVE = { duration: 0.32, ease: EASE_ENTRANCE };
const PIVOT = { transformOrigin: "12px 12px" };

const slotTransform = (slot: { x: number; y: number }, scale: number) => ({
  x: slot.x - CENTER,
  y: slot.y - CENTER,
  scale,
});

const MAIN_GROUP: Variants = {
  idle: { x: 0, y: 0, scale: 1, transition: SETTLE },
  hover: { ...slotTransform(SLOTS.topLeft, SLOT_SCALE), transition: ARRIVE },
};

/** Just the crease lines, faded out as the main box shrinks into the stack. */
const MAIN_DETAIL: Variants = {
  idle: { opacity: 1, transition: SETTLE },
  hover: { opacity: 0, transition: { duration: 0.15 } },
};

function clone(
  from: { x: number; y: number },
  slot: { x: number; y: number },
  delay: number,
): Variants {
  return {
    idle: { ...slotTransform(from, 0), opacity: 0, transition: { duration: 0.1 } },
    hover: {
      ...slotTransform(slot, SLOT_SCALE),
      opacity: 1,
      transition: { ...ARRIVE, delay },
    },
  };
}

// Off-canvas starting points, one per side the box arrives from.
const OFF_RIGHT = { x: 34, y: SLOTS.topRight.y };
const OFF_BOTTOM = { x: SLOTS.bottomLeft.x, y: 34 };
const OFF_CORNER = { x: 34, y: 34 };

const CLONES: Variants[] = [
  clone(OFF_RIGHT, SLOTS.topRight, 0.16),
  clone(OFF_BOTTOM, SLOTS.bottomLeft, 0.26),
  clone(OFF_CORNER, SLOTS.bottomRight, 0.36),
];

export function ProductsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <motion.g variants={MAIN_GROUP} style={PIVOT}>
        <path d={HEXAGON_D} />
        <motion.g variants={MAIN_DETAIL}>
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </motion.g>
      </motion.g>

      {CLONES.map((variants, i) => (
        <motion.g key={i} variants={variants} style={PIVOT}>
          <path d={HEXAGON_D} />
        </motion.g>
      ))}
    </IconSvg>
  );
}
