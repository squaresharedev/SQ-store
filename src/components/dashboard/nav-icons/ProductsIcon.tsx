import { useId } from "react";
import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Products: a label slaps on, a beat passes, the box jolts off to the right,
 * a longer beat passes off-screen, then the same box jolts back in from the
 * left, bare, to wait for the next hover.
 *
 * All timings below are seconds into the hover, so the two waits this reads
 * as are literal: nothing moves through SEND_WAIT once the label has landed,
 * and nothing moves through RETURN_WAIT once the box is off-canvas. The jolts
 * themselves stay short and sharp (SEND_END - SEND_START, RETURN_END -
 * RETURN_START) so slowing the loop reads as more patient, not more sluggish.
 *
 * The box only ever exists at one x position at a time, so its trip out and
 * its trip back are one keyframe track: idle, a small anticipation pull-back,
 * a hard jolt off the right edge, a jump straight to the left edge, and a
 * second jolt back to center. The label lives in the same group so it rides
 * along, and only needs its own opacity: on for the slap and the outbound
 * jolt, off before the jump.
 *
 * Both the box's jump and the label's cutoff use back-to-back keyframes a
 * hair apart (JUMP_GAP) rather than truly identical times or a merely-short
 * gap. Equal times risk a division by zero in the interpolation; a gap of a
 * few hundredths, which is what shipped before, is long enough for a real
 * frame to land mid-flight and paint the box or label somewhere it should
 * never be visible. A thousandth of a second is under one display frame at
 * any refresh rate, so the cut reads as instant without relying on exact
 * float equality.
 */
const DURATION = 2.2;
const JUMP_GAP = 0.001;

const LABEL_POP = 0.13;
const LABEL_SQUASH = 0.18;
const LABEL_REBOUND = 0.23;
const LABEL_FLUSH = 0.28;

const SEND_WAIT_END = 0.78;
const SEND_ANTICIPATE = 0.82;
const SEND_END = 1.04;
const SEND_END_GAP = SEND_END + JUMP_GAP;

const RETURN_WAIT_END = 1.64;
const RETURN_END = 1.86;
const RETURN_SETTLE = 2.01;

const at = (seconds: number) => seconds / DURATION;

const BOX_TRIP: Variants = {
  idle: { x: 0, transition: SETTLE },
  hover: {
    x: [0, 0, -0.8, 34, -34, -34, 0.8, -0.3, 0],
    transition: {
      duration: DURATION,
      times: [
        0,
        at(SEND_WAIT_END),
        at(SEND_ANTICIPATE),
        at(SEND_END),
        at(SEND_END_GAP),
        at(RETURN_WAIT_END),
        at(RETURN_END),
        at(RETURN_SETTLE),
        1,
      ],
      ease: [
        "linear",
        "easeOut",
        "easeOut",
        "linear",
        "linear",
        "easeOut",
        "easeInOut",
        "easeOut",
      ],
    },
  },
};

/**
 * The slap: drops in from above oversized and crooked, squashes flat on
 * impact, rebounds a touch, then settles flush. Rides along through the send
 * wait and the outbound jolt, and cuts at the same instant the box jumps, so
 * it's never visible popping on or off.
 */
const LABEL_SLAP: Variants = {
  idle: {
    opacity: 0,
    scale: 0.3,
    rotate: -18,
    y: -2.5,
    transition: { duration: 0.1 },
  },
  hover: {
    opacity: [0, 1, 1, 1, 1, 1, 0, 0],
    scale: [0.3, 1.35, 0.85, 1.05, 1, 1, 1, 1],
    rotate: [-18, 6, -2, 1, 0, 0, 0, 0],
    y: [-2.5, 0.4, 0, 0, 0, 0, 0, 0],
    transition: {
      duration: DURATION,
      times: [
        0,
        at(LABEL_POP),
        at(LABEL_SQUASH),
        at(LABEL_REBOUND),
        at(LABEL_FLUSH),
        at(SEND_END),
        at(SEND_END_GAP),
        1,
      ],
      ease: [
        "backOut",
        "easeOut",
        "easeOut",
        "easeInOut",
        "linear",
        "linear",
        "linear",
      ],
    },
  },
};

/** A short dash in the box's wake, smaller and far fewer than the cart's wind. Timed to the send jolt, not the jump. */
function particle(delay: number, duration: number, distance: number): Variants {
  return {
    idle: { opacity: 0, x: 0, transition: { duration: 0.1 } },
    hover: {
      opacity: [0, 0.85, 0],
      x: [0, -distance * 0.4, -distance],
      transition: { delay, duration, ease: EASE_ENTRANCE },
    },
  };
}

const PARTICLES: Array<{ d: string; variants: Variants }> = [
  { d: "M5 6h-1.6", variants: particle(SEND_ANTICIPATE, 0.16, 3) },
  { d: "M8 4h-1.4", variants: particle(SEND_ANTICIPATE + 0.03, 0.15, 2.6) },
  { d: "M4 12h-1.8", variants: particle(SEND_ANTICIPATE + 0.05, 0.17, 3.2) },
  { d: "M7 18h-1.5", variants: particle(SEND_ANTICIPATE + 0.09, 0.15, 2.6) },
  { d: "M4 20h-1.6", variants: particle(SEND_ANTICIPATE + 0.12, 0.16, 3) },
];

/**
 * The label as a parallelogram, not a rotated rectangle: the front-left wall
 * it sits on has vertical sides (the box's walls run straight down) and top
 * and bottom edges parallel to the rim's left-to-front edge, (3.29,7) to
 * (12,12), an (8.71, 5) run. A plain rotation tilts both axes together; this
 * keeps the vertical sides vertical and only skews the horizontal ones, the
 * same shear the wall itself is drawn with, so the label reads as flush
 * against it instead of floating in front at an angle.
 */
const LABEL_D = "M6.3 14.3L9.7 16.25L9.7 19.05L6.3 17.1Z";

export function ProductsIcon({ className }: NavIconProps) {
  // Sanitised because useId() ships colons, which are legal in an id but
  // hostile to a url(#...) reference.
  const clipId = `nav-products-${useId().replace(/:/g, "")}`;

  return (
    <IconSvg className={className}>
      <defs>
        <clipPath id={clipId}>
          {/* The glyph's own bounds, same inset as the dashboard icon's ride:
              the box and its particles are cut here instead of spilling past
              the icon into whatever sits next to it in the nav row. */}
          <rect x="1" y="1" width="22" height="22" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {PARTICLES.map(({ d, variants }, i) => (
          <motion.path key={i} variants={variants} d={d} />
        ))}

        <motion.g variants={BOX_TRIP}>
          <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
          <path d="M12 22V12" />
          <polyline points="3.29 7 12 12 20.71 7" />
          <path d="M12 12L3.29 7L7.65 4.50L16.36 9.50Z" />
          <path d="M12 2L20.71 7L16.36 9.50L7.65 4.50Z" />

          <motion.path
            variants={LABEL_SLAP}
            d={LABEL_D}
            fill="currentColor"
            stroke="none"
            style={{ originX: 0.5, originY: 0.5 }}
          />
        </motion.g>
      </g>
    </IconSvg>
  );
}
