import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Storefront: the waves of the awning swing right, then left, then settle.
 * The door stays shut.
 *
 * A skew pinned to the ridge does it: the roofline holds still while every
 * point below slides sideways in proportion to how far under the ridge it
 * sits, which puts all of the travel into the scalloped hem, the way an
 * awning moves when the wind catches it. The hem sits about 8 units below the
 * ridge, so 7 degrees carries the waves a full unit each way.
 */
const AWNING =
  "M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244";

const AWNING_SWAY: Variants = {
  idle: { skewX: 0, transition: SETTLE },
  hover: {
    skewX: [0, 7, -6, 3, 0],
    transition: { duration: 0.8, ease: EASE_STANDARD },
  },
};

export function StorefrontIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      <motion.path
        variants={AWNING_SWAY}
        style={{ originX: 0.5, originY: 0 }}
        d={AWNING}
      />
      <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
      <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" />
    </IconSvg>
  );
}
