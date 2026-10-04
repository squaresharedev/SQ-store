import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Discounts: the ticket gives a little shake, as if torn off a strip, while the
 * percent slash draws itself again and its two dots pop in after it.
 *
 * Geometry is lucide's ticket-percent, so at rest it is the static glyph.
 */
const TICKET_SHAKE: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: [0, -7, 4, 0],
    transition: { duration: 0.42, ease: EASE_STANDARD },
  },
};

const SLASH: Variants = {
  idle: { pathLength: 1, transition: SETTLE },
  hover: {
    pathLength: [0, 1],
    transition: { duration: 0.3, ease: EASE_ENTRANCE },
  },
};

/** A dot pops past full size once the slash has passed it. */
function dotVariants(delay: number): Variants {
  return {
    idle: { scale: 1, transition: SETTLE },
    hover: {
      scale: [1, 2.2, 1],
      transition: { delay, duration: 0.3, ease: EASE_ENTRANCE },
    },
  };
}

const TOP_DOT = dotVariants(0.12);
const BOTTOM_DOT = dotVariants(0.26);

export function DiscountsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      {/* Ticket, slash and dots as one, so the shake carries them together. */}
      <motion.g variants={TICKET_SHAKE}>
        <path d="M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
        <motion.path variants={TOP_DOT} d="M9 9h.01" />
        <motion.path variants={SLASH} d="m15 9-6 6" />
        <motion.path variants={BOTTOM_DOT} d="M15 15h.01" />
      </motion.g>
    </IconSvg>
  );
}
