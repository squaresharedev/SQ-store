// WHERE THE REVENUE HERO'S HEADLINE GOES, and how tall the chart has to be to
// let it sit there.
//
// The headline ("Revenue" and the figure) is laid over the plot instead of
// above it, in whichever top corner the line leaves free. Two questions, kept
// here as pure functions so the answers are testable without a browser:
//
//   heroSide     which corner: decided from the data alone, so the server and
//                the browser agree and the headline never jumps after load.
//   heroCeiling  the top of the value axis that keeps the line out from under
//                the headline, given how much of the plot the headline covers.

/** The top corner the headline sits in. */
export type HeroSide = "left" | "right";

/** The headline's box over the plot, in shares of the plot (0 to 1): how far
 *  across it starts and ends, and how far down from the top it reaches. */
export type HeroFootprint = { from: number; to: number; depth: number };

/** How much of the series each corner is judged on: its outer third. */
const CORNER_SHARE = 1 / 3;

/** Clear air kept above the tallest point, as a share of it, so the peak
 *  never touches the top of the plot. */
const HEADROOM = 0.06;

/** The deepest the headline is allowed to count as reaching. Past this the
 *  ceiling would grow without limit and flatten the line to nothing. */
const MAX_DEPTH = 0.75;

/**
 * The corner the line leaves free.
 *
 * A graph going up is low on the left, so the headline goes top left; a graph
 * going down is low on the right, so it goes top right. Judged on the PEAK of
 * each outer third and not on a fitted slope, because the question is where
 * there is room: a month that climbs overall but opened with one big day has
 * its room on the right, and a slope would put the figure on top of that day.
 * A tie goes left, where a reader starts.
 */
export function heroSide(values: number[]): HeroSide {
  if (values.length < 2) return "left";
  const span = Math.max(1, Math.ceil(values.length * CORNER_SHARE));
  const leftPeak = Math.max(...values.slice(0, span));
  const rightPeak = Math.max(...values.slice(-span));
  return rightPeak < leftPeak ? "right" : "left";
}

/**
 * The top of the value axis: the lowest one that clears both rules.
 *
 *   1. The tallest point anywhere keeps HEADROOM above it.
 *   2. The stretch of line UNDER the headline stays below the headline.
 *
 * Only that stretch is held down, which is the point of choosing a corner: on
 * the free side the line is low already, so rule 2 costs little, and the peak
 * on the other side still climbs past the figure to the top of the chart.
 *
 * The stretch is widened to the points just outside the footprint, because the
 * curve between an outside point and an inside one runs through the
 * footprint's edge.
 */
export function heroCeiling(values: number[], footprint: HeroFootprint): number {
  const peak = Math.max(0, ...values);
  if (peak === 0) return 0;
  const last = values.length - 1;
  const clampIndex = (index: number) => Math.min(last, Math.max(0, index));
  const start = clampIndex(Math.floor(footprint.from * last));
  const end = clampIndex(Math.ceil(footprint.to * last));
  const under = Math.max(0, ...values.slice(start, end + 1));
  const depth = Math.min(MAX_DEPTH, Math.max(0, footprint.depth));
  return Math.max(peak * (1 + HEADROOM), under / (1 - depth));
}
