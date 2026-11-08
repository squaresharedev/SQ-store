// Reusable analytics chart kit — Recharts 3 under the hood, app tokens on the
// surface (ScrubChart aside, plain SVG). The families, each with subtypes:
//
//   LineChart       variant="line" | "area"            trend over time
//                   (+ `bleed`: edge to edge, on the page instead of in a card)
//   BarChart        variant="grouped" | "stacked"      vertical columns
//   HBarChart       variant="grouped" | "stacked"      horizontal bars
//   CompositionBar  (single divided total bar)         the "one line" h-subtype
//   PieChart        variant="donut" | "pie"            part-to-whole
//   ScrubChart      (one series, optional dashed one)  a trend read by moving
//                   along it, or a bare sparkline; plain SVG
//
// A page can set how much scale every chart in it prints (ChartStyleProvider:
// full axes, or the Payments tab's quiet ones) instead of passing it to each.
//
// Ground rules baked in: colour is monochrome-first — ink for the primary
// series, greys for context, blue as the 4th slot / deliberate highlight, and
// green/red reserved for pinned good/bad meaning (colorIndex 4/5) — never
// re-sorted, never cycled; legends appear automatically at ≥2 series and sync
// hover with the plot; tooltips glide with the pointer, enhance but never
// gate (sr-only table twins / value legends carry every number); entrance
// animation honours prefers-reduced-motion.

export { LineChart, type LineChartProps } from "@/components/charts/LineChart";
export { BarChart, type BarChartProps } from "@/components/charts/BarChart";
export { HBarChart, type HBarChartProps } from "@/components/charts/HBarChart";
export {
  CompositionBar,
  type CompositionBarProps,
} from "@/components/charts/CompositionBar";
export { PieChart, type PieChartProps } from "@/components/charts/PieChart";
export { ScrubChart, type ScrubChartProps } from "@/components/charts/ScrubChart";
export { CompareLegend } from "@/components/charts/CompareLegend";
export {
  CHART_STYLE_DEFAULTS,
  ChartStyleProvider,
  useChartStyle,
  type ChartAxes,
  type ChartStyle,
} from "@/components/charts/style";
export { ChartTooltipContent } from "@/components/charts/ChartTooltip";
export { ChartLegend, SliceLegend } from "@/components/charts/ChartLegend";
export { ChartDataTable } from "@/components/charts/ChartDataTable";
export type { ChartDatum, ChartSeries, ChartSlice } from "@/components/charts/types";
export {
  BLEED,
  CHART,
  CATEGORICAL,
  CHART_ANIMATION,
  MARK,
  PLOT,
  QUIET,
  SCRUB,
  bleedFade,
  bleedPlot,
  tooltipWrapperClass,
  tooltipLabelClass,
  tooltipValueClass,
} from "@/components/charts/theme";
export { compactNumber, formatNumber, formatShare } from "@/components/charts/format";
export { niceTicks } from "@/components/charts/scale";
