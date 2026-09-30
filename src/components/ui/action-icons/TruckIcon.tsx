"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { ActionIconSvg } from "./ActionIconSvg";
import { DURATION, SETTLE } from "@/components/ui/motion-tokens";

/**
 * Truck: lucide's delivery van, with a hover lurch and an engine that can run.
 *
 * A wheel here is a ring of radius 2, and a plain ring turned about its own
 * centre looks exactly like a ring that is not turning. So `driving` cuts one
 * notch out of each ring and spins that, which is the only thing at this size
 * that reads as a wheel going round. At rest the dash is the full
 * circumference and the ring is lucide's own circle, so the idle glyph is
 * pixel-identical to the static original.
 *
 * Wheels carry their own `animate` rather than joining the hover variants: the
 * lurch belongs to the whole vehicle, the spin to the wheels alone, and a wheel
 * that inherited "hover" would stop turning the moment the cursor left.
 */

/** Circumference of a wheel (r=2). */
const WHEEL_RING = 2 * Math.PI * 2;
/** One dash the length of the ring: lucide's circle, unbroken. */
const RING_SOLID = `${WHEEL_RING.toFixed(3)} 0`;
/**
 * One narrow notch, so the wheel has a mark that visibly goes round. Kept to a
 * fifth of the ring on purpose: a wheel is a thick ring fused to the body's
 * underside, so a wider notch, or several, reads as the truck being chipped
 * rather than as a wheel turning (tried, and looked broken).
 */
const RING_NOTCHED = `${(WHEEL_RING * 0.8).toFixed(3)} ${(WHEEL_RING * 0.2).toFixed(3)}`;

/**
 * Where each wheel meets the ground, as a share of the icon's width and height
 * (lucide's 24-unit box): for whatever wants to throw dust up from them.
 */
export const TRUCK_WHEELS = [
  { x: 7 / 24, y: 21 / 24 },
  { x: 17 / 24, y: 21 / 24 },
] as const;

/** Seconds for one full turn of a wheel while the truck is running. */
const WHEEL_TURN = 0.3;

const WHEEL_PARKED = {
  strokeDasharray: RING_SOLID,
  rotate: 0,
  transition: SETTLE,
};

const WHEEL_TURNING = {
  strokeDasharray: RING_NOTCHED,
  rotate: 360,
  transition: {
    strokeDasharray: { duration: DURATION.fast },
    rotate: { duration: WHEEL_TURN, ease: "linear" as const, repeat: Infinity },
  },
};

/** Hover: the van eases forward a touch, like an engine catching. */
const LURCH: Variants = {
  idle: { x: 0, transition: SETTLE },
  hover: { x: 1.5, transition: { duration: 0.26, ease: "backOut" } },
};

/** Running: the whole van shivers on its springs. Sub-pixel, and all the better for it. */
const RUMBLE = {
  y: [0, -0.6, 0],
  transition: { duration: 0.12, ease: "easeInOut" as const, repeat: Infinity },
};

function Wheel({ cx, turning }: { cx: number; turning: boolean }) {
  return (
    <motion.circle
      cx={cx}
      cy={18}
      r={2}
      // Butt caps, so the gaps stay the width they were cut to.
      strokeLinecap="butt"
      initial={false}
      animate={turning ? WHEEL_TURNING : WHEEL_PARKED}
      style={{ originX: 0.5, originY: 0.5 }}
    />
  );
}

export function TruckIcon({
  className,
  /** True while the truck is working: wheels turning, body shivering. */
  driving = false,
}: {
  className?: string;
  driving?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  // `animate` outranks the variant label the button propagates, so the run has
  // to be withheld entirely when idle rather than switched off with a zero
  // offset, which would pin the truck flat and eat the hover lurch.
  const running = driving && !reducedMotion;

  return (
    <ActionIconSvg className={className}>
      <motion.g variants={running ? undefined : LURCH} animate={running ? RUMBLE : undefined}>
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <Wheel cx={17} turning={running} />
        <Wheel cx={7} turning={running} />
      </motion.g>
    </ActionIconSvg>
  );
}
