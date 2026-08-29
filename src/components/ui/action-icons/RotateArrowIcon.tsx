"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { ActionIconSvg } from "./ActionIconSvg";
import { SETTLE } from "@/components/ui/motion-tokens";

/**
 * Rotate: a circle drawn open and finished with an arrowhead, nudged round on
 * hover.
 *
 * A part-turn rather than a full revolution, because the glyph is already a
 * loop — it does not need to complete one to say "again". The arrowhead is the
 * only thing on it that reads as a position, so a 45deg step is plainly visible
 * as movement while the ring itself stays put. The overshoot on the way in is
 * what makes it land as a flick of the wrist instead of a slow sweep.
 *
 * Pivot is the bbox centre, which is also the circle's centre (12,12), so the
 * ring turns in place and only the arrowhead travels.
 */
const NUDGE: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: 45,
    transition: { duration: 0.26, ease: "backOut" },
  },
};

/** In-flight: the same ring, turning continuously, no overshoot and no settle. */
const SPIN = {
  rotate: 360,
  transition: { duration: 0.9, ease: "linear" as const, repeat: Infinity },
};

export function RotateArrowIcon({
  className,
  /** True while the rotation request is in flight: the ring keeps turning. */
  spinning = false,
}: {
  className?: string;
  spinning?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  // `animate` outranks the variant label the button propagates, so the spin has
  // to be withheld entirely when idle rather than switched off with a zero
  // rotation, which would pin the icon flat and eat the hover story.
  const spin = spinning && !reducedMotion;

  return (
    <ActionIconSvg className={className}>
      <motion.g
        variants={spin ? undefined : NUDGE}
        animate={spin ? SPIN : undefined}
        style={{ originX: 0.5, originY: 0.5 }}
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </motion.g>
    </ActionIconSvg>
  );
}
