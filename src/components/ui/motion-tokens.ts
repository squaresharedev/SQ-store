/**
 * The JS mirror of the motion tokens in globals.css. Choreography needs
 * per-keyframe timing that CSS transitions cannot express, so the curves are
 * restated here instead of consumed as Tailwind utilities. Keep these in sync
 * with --ease-standard / --ease-entrance.
 *
 * Lives in ui/ rather than beside any one icon set: the nav rail and the
 * in-page action buttons both animate against these, and two mirrors of the
 * same CSS variable is one mirror too many.
 */
export const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];
export const EASE_ENTRANCE: [number, number, number, number] = [
  0.16, 1, 0.3, 1,
];

/** Seconds, mirroring --transition-duration-fast/base/slow. */
export const DURATION = { fast: 0.12, base: 0.18, slow: 0.26 } as const;

/** Return-to-idle when the cursor leaves mid-story: quick and quiet. */
export const SETTLE = { duration: DURATION.base, ease: EASE_STANDARD };

/** One step of a multi-step flow handing over to the next (wizards, setup). */
export const STEP_SWAP = { duration: DURATION.base, ease: EASE_STANDARD };

/** Something small landing with a little overshoot: a badge, a status. */
export const POP = { type: "spring", stiffness: 420, damping: 18 } as const;
