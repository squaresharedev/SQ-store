import { motion, useReducedMotion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_STANDARD, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Settings: the gear clicks one notch forward on a spring, and stays there.
 *
 * The gear outline is 6-fold symmetric, so 60 degrees lands on an identical
 * silhouette: the journey is the animation, the destination is invisible.
 * That is what lets each hover simply add another notch rather than winding
 * back, and why the angle can keep climbing without ever looking wrong.
 *
 * Damping 20 keeps one visible overshoot but settles inside ~500ms; softer
 * springs ring on past the budget before motion's rest thresholds bite.
 */
const NOTCH = 60;
const CLICK = { type: "spring" as const, stiffness: 260, damping: 20 };

const HUB_TIGHTEN: Variants = {
  idle: { scale: 1, transition: SETTLE },
  hover: {
    scale: [1, 0.8, 1],
    transition: {
      delay: 0.05,
      duration: 0.3,
      times: [0, 0.5, 1],
      ease: EASE_STANDARD,
    },
  },
};

export function SettingsIcon({ className, hoverCount = 0 }: NavIconProps) {
  const reducedMotion = useReducedMotion();
  const rotate = reducedMotion ? 0 : hoverCount * NOTCH;

  return (
    <IconSvg className={className}>
      <motion.path
        animate={{ rotate }}
        transition={CLICK}
        d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
      />
      <motion.circle variants={HUB_TIGHTEN} cx="12" cy="12" r="3" />
    </IconSvg>
  );
}
