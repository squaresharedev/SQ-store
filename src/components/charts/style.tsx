"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * How much of its scale a cartesian chart prints.
 *
 *   full   a value axis down the side, a date under every few points, solid
 *          gridlines at every value label. The kit's default.
 *   quiet  the Payments tab's look: no value axis (the readout and the table
 *          twin still carry every value), dates only at the two ends and the
 *          middle, faint dotted guides over a solid baseline, and a fuller
 *          wash under an area. Far less ink around the data, which is most of
 *          why a chart reads as clean.
 */
export type ChartAxes = "full" | "quiet";

/** The look a page sets once for every kit chart inside it. */
export type ChartStyle = { axes: ChartAxes };

export const CHART_STYLE_DEFAULTS: ChartStyle = { axes: "full" };

const ChartStyleContext = createContext<ChartStyle>(CHART_STYLE_DEFAULTS);

/** Sets the look of every kit chart under it; a chart's own prop still wins. */
export function ChartStyleProvider({ value, children }: { value: ChartStyle; children: ReactNode }) {
  return <ChartStyleContext.Provider value={value}>{children}</ChartStyleContext.Provider>;
}

/** The look the nearest ChartStyleProvider set (the defaults without one). */
export function useChartStyle(): ChartStyle {
  return useContext(ChartStyleContext);
}
