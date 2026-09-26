"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import { DURATION, EASE_ENTRANCE, EASE_STANDARD, SETTLE } from "@/components/ui/motion-tokens";
import { cn } from "@/lib/utils";

/**
 * The passkey mark: lucide's fingerprint, ridge for ridge, so at rest it is
 * pixel-identical to the static icon it replaces, and alive in the moments a
 * passkey is actually in play.
 *
 *   idle      the plain icon.
 *   scanning  the browser's passkey prompt is open (or the server is
 *             checking): the ridges pulse outward from the core while a
 *             reading line sweeps down and back, the way a sensor reads.
 *   success   the ridges draw themselves in from the core outward, as if the
 *             print had just been recorded.
 *   error     one short shake: "that did not take". Remount (key) to replay.
 *
 * Purely decorative (aria-hidden): every state change is also said in words
 * by the control that owns it. Reduced motion shows the plain icon in every
 * state, because a pulsing or shaking glyph is exactly the motion that
 * setting asks to be spared.
 */

export type FingerprintState = "idle" | "scanning" | "success" | "error";

/**
 * lucide `fingerprint-pattern` (v1.23), reordered from the core outward so
 * that a stagger by index ripples out from the centre of the print. The last
 * entry is a dot (a zero-length stroke with a round cap): it only fades.
 */
const RIDGES = [
  "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",
  "M14 13.12c0 2.38 0 6.38-1 8.88",
  "M9 6.8a6 6 0 0 1 9 5.2v2",
  "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",
  "M8.65 22c.21-.66.45-1.32.57-2",
  "M17.29 21.02c.12-.6.43-2.3.5-3.02",
  "M2 12a10 10 0 0 1 18-6",
  "M21.8 16c.2-2 .131-5.354 0-6",
] as const;
const DOT = "M2 16h.01";

/** One sweep of the reading line, down and back. */
const SCAN_SECONDS = 1.6;
/** Gap between neighbouring ridges, core outward. */
const RIPPLE_STEP = 0.07;
/** How long one ridge takes to draw itself in. */
const DRAW_SECONDS = 0.45;
/** The whole "that did not take" shake. */
const SHAKE_SECONDS = 0.36;

const RIDGE: Variants = {
  idle: { pathLength: 1, opacity: 1, transition: SETTLE },
  scanning: (index: number) => ({
    pathLength: 1,
    opacity: [1, 0.35, 1],
    transition: {
      duration: SCAN_SECONDS,
      delay: index * RIPPLE_STEP,
      repeat: Infinity,
      ease: EASE_STANDARD,
    },
  }),
  success: (index: number) => ({
    pathLength: [0, 1],
    opacity: [0.3, 1],
    transition: { duration: DRAW_SECONDS, delay: index * RIPPLE_STEP, ease: EASE_ENTRANCE },
  }),
  error: { pathLength: 1, opacity: 1, transition: SETTLE },
};

const DOT_FADE: Variants = {
  idle: { opacity: 1, transition: SETTLE },
  scanning: { opacity: [1, 0.35, 1], transition: { duration: SCAN_SECONDS, repeat: Infinity } },
  success: {
    opacity: [0, 1],
    transition: { duration: DURATION.base, delay: RIDGES.length * RIPPLE_STEP, ease: EASE_ENTRANCE },
  },
  error: { opacity: 1, transition: SETTLE },
};

const GLYPH: Variants = {
  idle: { x: 0 },
  scanning: { x: 0 },
  success: { x: 0 },
  error: { x: [0, -1.6, 1.6, -1, 1, 0], transition: { duration: SHAKE_SECONDS, ease: EASE_STANDARD } },
};

export function AnimatedFingerprint({
  state = "idle",
  className,
}: {
  state?: FingerprintState;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const shown: FingerprintState = reducedMotion ? "idle" : state;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-fingerprint-state={shown}
      className={cn("size-4 shrink-0 overflow-visible", className)}
    >
      <motion.g variants={GLYPH} initial="idle" animate={shown}>
        {RIDGES.map((d, index) => (
          <motion.path key={d} d={d} custom={index} variants={RIDGE} initial="idle" animate={shown} />
        ))}
        <motion.path d={DOT} variants={DOT_FADE} initial="idle" animate={shown} />
      </motion.g>
      {shown === "scanning" && (
        <motion.line
          x1="3"
          x2="21"
          y1="0"
          y2="0"
          strokeWidth={1.5}
          initial={{ y: 3, opacity: 0 }}
          animate={{ y: [3, 21, 3], opacity: [0, 0.9, 0.9, 0.9, 0] }}
          transition={{ duration: SCAN_SECONDS, repeat: Infinity, ease: EASE_STANDARD }}
        />
      )}
    </svg>
  );
}
