"use client";

import { motion, type Variants } from "motion/react";
import { ActionIconSvg } from "./ActionIconSvg";
import { EASE_STANDARD } from "@/components/ui/motion-tokens";

/**
 * Embed: the `<>` unfolds into a square — the frame the snippet drops onto
 * someone else's page.
 *
 * Both chevrons turn the SAME -45deg, because this is one rigid rotation of the
 * whole glyph, not two independent flips. What separates them is where each
 * pivots and where it then travels: the `<` hinges on its own point at (2,12)
 * and slides down-left, the `>` hinges on (22,12) and slides up-right.
 *
 * The numbers are chosen so the two corners land on ONE square rather than
 * merely near each other. Each chevron arm is 6 across and 6 down, so 8.49
 * long; a square whose side is exactly twice that (17, spanning 3.5 to 20.5 on
 * both axes) is the one where the arms reach precisely the midpoint of each
 * edge. Half of every side ends up drawn and half stays open, which is what
 * makes it read as a crop mark bracketing a region instead of a box with four
 * dents in it. Rounder numbers overlap the strokes at the midpoints, and round
 * caps stacked on round caps show as a visible lump.
 *
 * Pivot-to-target follows from that: (2,12) -> (3.5,20.5) is (+1.5, +8.5) and
 * (22,12) -> (20.5,3.5) is its exact negative, so the pair stays symmetric
 * about the icon's centre the whole way across.
 *
 * Motion composes as translate-then-rotate about the origin, so each chevron's
 * point lands at origin + (x,y) with its arms swung by the rotation — the two
 * halves of the transform can be reasoned about separately.
 *
 * Snappy on purpose: the corners cross most of the icon, and taken slowly that
 * distance reads as two pieces drifting into position. `backOut` overshoots the
 * square by a hair and pulls back, which is what makes them land rather than
 * arrive, and the short duration keeps the whole thing inside the moment the
 * cursor settles. The return is faster still — an animation reversing itself is
 * a correction, not a story, so it gets out of the way.
 */
const SQUARE_TURN = { duration: 0.2, ease: "backOut" as const };
const SQUARE_RETURN = { duration: 0.13, ease: EASE_STANDARD };

const LEFT_CHEVRON: Variants = {
  idle: { x: 0, y: 0, rotate: 0, transition: SQUARE_RETURN },
  hover: { x: 1.5, y: 8.5, rotate: -45, transition: SQUARE_TURN },
};

const RIGHT_CHEVRON: Variants = {
  idle: { x: 0, y: 0, rotate: 0, transition: SQUARE_RETURN },
  hover: { x: -1.5, y: -8.5, rotate: -45, transition: SQUARE_TURN },
};

export function EmbedCodeIcon({ className }: { className?: string }) {
  return (
    <ActionIconSvg className={className}>
      {/* `>` — point at (22,12), so it pivots on the right edge of its own box. */}
      <motion.path
        variants={RIGHT_CHEVRON}
        style={{ originX: 1, originY: 0.5 }}
        d="m16 18 6-6-6-6"
      />
      {/* `<` — point at (2,12), pivoting on the left edge of its own box. */}
      <motion.path
        variants={LEFT_CHEVRON}
        style={{ originX: 0, originY: 0.5 }}
        d="m8 6-6 6 6 6"
      />
    </ActionIconSvg>
  );
}
