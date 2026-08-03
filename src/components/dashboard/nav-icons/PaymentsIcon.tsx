import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Payments: the card tips a little, and lies back down when you leave.
 */
const CARD_TILT: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    // Overshoots a degree and settles, so it reads as the card being tipped
    // rather than simply arriving at an angle.
    rotate: [0, -8, -6],
    transition: { duration: 0.32, ease: EASE_ENTRANCE },
  },
};

export function PaymentsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      {/* Card and stripe tip as one; separate siblings drift apart. */}
      <motion.g variants={CARD_TILT}>
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </motion.g>
    </IconSvg>
  );
}
