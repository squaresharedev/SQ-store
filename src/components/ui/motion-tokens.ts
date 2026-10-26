/**
 * The JS mirror of the motion tokens in globals.css. Choreography needs
 * per-keyframe timing that CSS transitions cannot express, so the curves are
 * restated here instead of consumed as Tailwind utilities. Keep these in sync
 * with --ease-standard / --ease-entrance / --ease-exit.
 *
 * Lives in ui/ rather than beside any one icon set: the nav rail and the
 * in-page action buttons both animate against these, and two mirrors of the
 * same CSS variable is one mirror too many.
 */
export const EASE_STANDARD: [number, number, number, number] = [0.4, 0, 0.2, 1];
export const EASE_ENTRANCE: [number, number, number, number] = [
  0.16, 1, 0.3, 1,
];
/** Accelerating away: something picking up speed as it leaves. */
export const EASE_EXIT: [number, number, number, number] = [
  0.55, 0.085, 0.68, 0.53,
];

/** Seconds, mirroring --transition-duration-fast/base/slow. */
export const DURATION = { fast: 0.12, base: 0.18, slow: 0.26 } as const;

/** Return-to-idle when the cursor leaves mid-story: quick and quiet. */
export const SETTLE = { duration: DURATION.base, ease: EASE_STANDARD };

/** One step of a multi-step flow handing over to the next (wizards, setup). */
export const STEP_SWAP = { duration: DURATION.base, ease: EASE_STANDARD };

/** Something small landing with a little overshoot: a badge, a status. */
export const POP = { type: "spring", stiffness: 420, damping: 18 } as const;

/** The scale a button sinks to while it is held down; POP brings it back with a little bounce. */
export const PRESS_SCALE = 0.95;

/**
 * How long a click may take before it earns a loading state. Under this the
 * result lands before anyone could read a spinner, so showing one is flicker,
 * not feedback. Every loading indicator that answers a click (the Button's
 * `pending`, the navigation bar) waits this long; change it here to change
 * them all.
 */
export const PENDING_DELAY_MS = 300;

/** Once a loading state shows, the least time it stays, so a result arriving
 *  just after PENDING_DELAY_MS reads as a moment, not a flash. */
export const PENDING_MIN_SHOW_MS = 400;
