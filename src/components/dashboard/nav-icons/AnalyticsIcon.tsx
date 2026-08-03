import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Analytics: the bars collapse and re-grow from the baseline, left to right,
 * each overshooting its mark like fresh data landing.
 */
function barVariants(delay: number): Variants {
  return {
    idle: { scaleY: 1, transition: SETTLE },
    hover: {
      scaleY: [0, 1.15, 1],
      transition: {
        delay,
        duration: 0.3,
        times: [0, 0.7, 1],
        ease: EASE_ENTRANCE,
      },
    },
  };
}

const BAR_SHORT = barVariants(0);
const BAR_TALL = barVariants(0.07);
const BAR_MID = barVariants(0.14);

export function AnalyticsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <motion.path variants={BAR_SHORT} style={{ originY: 1 }} d="M8 17v-3" />
      <motion.path variants={BAR_TALL} style={{ originY: 1 }} d="M13 17V5" />
      <motion.path variants={BAR_MID} style={{ originY: 1 }} d="M18 17V9" />
    </IconSvg>
  );
}
