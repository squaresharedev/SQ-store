import type { MotionPreset, StorefrontTheme } from "@/types/storefront";

/**
 * HOW A BOARD ARRIVES ON SCREEN (theme.motion), as pure rules: which preset is
 * playing, whether this page may hide a block to reveal it later, and in what
 * order a batch of blocks steps in. The DOM side is board-reveal.ts; the CSS
 * that does the moving is the "motion and finish" section at the end of
 * globals.css.
 *
 * THE PROMISE. A board is never left invisible. On first paint the blocks play
 * a CSS arrival that needs no script and always ends visible. Script only ever
 * hides a block the observer has just REPORTED as off screen, which proves the
 * observer works and will report it again when it scrolls in. No observer, an
 * automated browser (a preview being photographed), reduced motion or print:
 * nothing is hidden at all.
 */

/** A preset that moves. */
export type MovingPreset = Exclude<MotionPreset, "none">;

/** Set the board's motion. `none` DROPS the key (absent is none), so a seller
 *  who turns it off is back to the theme a storefront had before motion. */
export function withMotion(theme: StorefrontTheme, motion: MotionPreset): StorefrontTheme {
  if (motion === "none") {
    if (!("motion" in theme)) return theme;
    const { motion: dropped, ...still } = theme;
    void dropped;
    return still;
  }
  return theme.motion === motion ? theme : { ...theme, motion };
}

/** The arrival this board plays, or null when it stands still (absent and
 *  `none` alike, so a storefront saved before motion renders as it did). */
export function boardMotion(theme: Pick<StorefrontTheme, "motion">): MovingPreset | null {
  return theme.motion === "subtle" || theme.motion === "lively" ? theme.motion : null;
}

/** On the hidden anchor StorefrontBoard renders before its grid; its value is
 *  the preset. The CSS scopes every rule by it. */
export const BOARD_MOTION_ATTRIBUTE = "data-board-motion";

/** Every block cell the shared Grid renders carries this attribute. */
export const GRID_CELL_SELECTOR = "[data-grid-cell]";

/**
 * Written on a block cell by board-reveal.ts, never by React:
 *   - `wait`: reported off screen, hidden until it scrolls in;
 *   - `in`: it has scrolled in, and plays the arrival now;
 *   - `still`: this page shows everything at once (an automated browser).
 * Absent: the cell plays the first-paint arrival and is otherwise left alone.
 */
export const REVEAL_ATTRIBUTE = "data-reveal";
export type RevealState = "wait" | "in" | "still";

/** The custom property carrying a cell's place in its batch's stagger. */
export const REVEAL_STEP_PROPERTY = "--reveal-step";

/**
 * How many places a stagger has: blocks past the last share it, so a long row
 * arriving together never keeps its last block waiting. Mirrored by the
 * first-paint `:nth-child` rules in globals.css.
 */
export const REVEAL_STAGGER_STEPS = 6;

/** What the page knows about where it is running. */
export type MotionEnvironment = {
  /** IntersectionObserver exists. */
  observer: boolean;
  /** The reader asked for reduced motion. */
  reducedMotion: boolean;
  /** An automated browser (navigator.webdriver): a preview being
   *  photographed in full, which never scrolls a block into view. */
  automated: boolean;
};

/** Whether this page may hide a block now and reveal it when it scrolls in. */
export function mayHideForReveal(env: MotionEnvironment): boolean {
  return env.observer && !env.reducedMotion && !env.automated;
}

/**
 * Each block's place in the stagger of a batch arriving together, by where it
 * sits on screen (top to bottom, then left to right) rather than the order the
 * observer happened to list them. Only `lively` staggers; `subtle` fades a
 * batch in at once.
 */
export function revealSteps(
  boxes: readonly { top: number; left: number }[],
  preset: MovingPreset,
): number[] {
  if (preset !== "lively") return boxes.map(() => 0);
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const steps = new Array<number>(boxes.length);
  order.forEach(({ index }, rank) => {
    steps[index] = Math.min(rank, REVEAL_STAGGER_STEPS - 1);
  });
  return steps;
}
