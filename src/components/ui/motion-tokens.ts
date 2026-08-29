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

/** Return-to-idle when the cursor leaves mid-story: quick and quiet. */
export const SETTLE = { duration: 0.18, ease: EASE_STANDARD };
