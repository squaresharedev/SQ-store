import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Discounts: lucide's price tag, and nothing else. At rest it is the plain
 * static glyph; on hover the whole tag jiggles in decaying passes and settles.
 */
const TAG_JIGGLE: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: [0, -14, 12, -9, 6, -3, 0],
    transition: { duration: 0.6, ease: EASE_STANDARD },
  },
};

export function DiscountsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <motion.g variants={TAG_JIGGLE} style={{ originX: 0.5, originY: 0.5 }}>
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </motion.g>
    </IconSvg>
  );
}
