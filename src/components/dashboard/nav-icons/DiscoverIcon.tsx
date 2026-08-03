import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Discover: the needle swings like a real compass seeking a bearing, each
 * oscillation smaller than the last, and settles where it began.
 */
const NEEDLE_SEEK: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    rotate: [0, -28, 18, -7, 0],
    transition: {
      duration: 0.55,
      times: [0, 0.28, 0.58, 0.82, 1],
      ease: EASE_STANDARD,
    },
  },
};

export function DiscoverIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <circle cx="12" cy="12" r="10" />
      <motion.path
        variants={NEEDLE_SEEK}
        d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
      />
    </IconSvg>
  );
}
