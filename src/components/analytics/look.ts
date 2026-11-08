import type { CSSProperties } from "react";
import { CHART, type ChartAxes } from "@/components/charts";
import { runningTotal } from "@/lib/series";

// HOW THE ANALYTICS PAGE IS DRAWN, as one set of choices.
//
// The Payments tab's charts read as cleaner than this page's, and the reasons
// are separate things that can each be taken or left: far less text around the
// plot, a line read by moving along it instead of a tooltip box, a running
// total that climbs instead of a day-by-day zig-zag, the figure above the
// chart in a card instead of over it, tiles that carry their own change and
// sparkline, and one deeper colour. Each is a field here, so /dev/analytics-lab
// can try them one at a time on the real page. ANALYTICS_LOOK is what
// /analytics renders: the user's pick of 2026-11-08.

/** What a scrub line draws: each bucket's own value, or the total so far. */
export type ScrubLine = "daily" | "running";

export type AnalyticsLook = {
  /** The revenue headline: "frame" (corner marks, the chart bled across the
   *  page with the figure laid over it) or "card" (the Payments tab's earnings
   *  chart: the figure above a scrubbable line, in a card). */
  lead: "frame" | "card";
  /** The sales tiles: "plain" (a figure and a hint) or "trend" (a change chip,
   *  the figure before, and a sparkline where there is a series to draw). */
  tiles: "plain" | "trend";
  /** The card lead and trend tiles as one block with hairlines between them,
   *  as on the Payments tab. Only with lead "card" and tiles "trend". */
  joined: boolean;
  /** The trend cards (average order, each source's trend): "axes" (the kit's
   *  LineChart with a tooltip) or "scrub" (a figure in the card, read by moving
   *  along a plain line). */
  trends: "axes" | "scrub";
  /** What every scrub line draws (the lead card's, the trend cards', the
   *  tiles' sparklines). */
  line: ScrubLine;
  /** How much scale every other chart prints (the kit's ChartStyle). */
  axes: ChartAxes;
  /** The colour money is drawn in: green (palette.ts), the Payments tab's
   *  purple, or ink. */
  money: "green" | "purple" | "ink";
  /** The headline figure: green, or ink with the line carrying the colour. */
  figure: "green" | "ink";
};

/**
 * What /analytics renders, picked in the lab on 2026-11-08: the Payments
 * tab's revenue card and trend tiles (joined, lines adding up, the figure in
 * ink), while every chart keeps its full axes and money stays green.
 */
export const ANALYTICS_LOOK: AnalyticsLook = {
  lead: "card",
  tiles: "trend",
  joined: true,
  trends: "axes",
  line: "running",
  axes: "full",
  money: "green",
  figure: "ink",
};

/** The page before that pick: the corner-mark revenue hero over plain tiles. */
export const FRAME_LOOK: AnalyticsLook = {
  lead: "frame",
  tiles: "plain",
  joined: false,
  trends: "axes",
  line: "daily",
  axes: "full",
  money: "green",
  figure: "green",
};

/** The Payments tab's look, every part of it. */
export const PAYMENTS_LOOK: AnalyticsLook = {
  lead: "card",
  tiles: "trend",
  joined: true,
  trends: "scrub",
  line: "running",
  axes: "quiet",
  money: "purple",
  figure: "ink",
};

/** Each money colour, as the token it is drawn with. */
const MONEY_COLOR: Record<AnalyticsLook["money"], string> = {
  green: CHART.positive,
  purple: CHART.earnings,
  ink: CHART.ink,
};

/** The colour a money line is drawn in, for a chart that takes one directly. */
export const moneyColor = (look: AnalyticsLook): string => MONEY_COLOR[look.money];

/**
 * Recolours every money mark on the page at once. The kit's charts draw money
 * through the green slot (TONE.money resolves to --chart-positive), so the page
 * re-points that variable for everything inside it; the change chips and the
 * figure use the success colour, not this one, and keep their meaning. It is
 * for trying colours in the lab: a money colour other than green that ships
 * should become its own token (globals.css) and palette slot instead.
 */
export function moneyStyle(look: AnalyticsLook): CSSProperties | undefined {
  return look.money === "green" ? undefined : ({ "--chart-positive": MONEY_COLOR[look.money] } as CSSProperties);
}

/** The headline figure's text colour. */
export const FIGURE_CLASS: Record<AnalyticsLook["figure"], string> = {
  green: "text-success",
  ink: "text-foreground",
};

/** A count or a sum as a line: each bucket's own, or the total so far. A gap
 *  (no bucket to compare with) stays a gap; the total carries on past it. */
export function sumLine(values: (number | null)[], line: ScrubLine): (number | null)[] {
  if (line === "daily") return values;
  const totals = runningTotal(values.map((value) => value ?? 0));
  return values.map((value, index) => (value === null ? null : totals[index]));
}

/**
 * An average (order value) as a line: each bucket's own, null where nothing
 * sold (an average of nothing is not zero), or the average so far, which is
 * null only until the first sale.
 */
export function averageLine(
  buckets: { totalCents: number; count: number }[],
  line: ScrubLine,
): (number | null)[] {
  let total = 0;
  let count = 0;
  return buckets.map((bucket) => {
    total += bucket.totalCents;
    count += bucket.count;
    if (line === "daily") return bucket.count > 0 ? Math.round(bucket.totalCents / bucket.count) : null;
    return count > 0 ? Math.round(total / count) : null;
  });
}
