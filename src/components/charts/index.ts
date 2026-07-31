// Reusable analytics chart kit — Recharts 3 under the hood, app tokens on the
// surface. Four families, each with subtypes:
//
//   LineChart       variant="line" | "area"            trend over time
//   BarChart        variant="grouped" | "stacked"      vertical columns
//   HBarChart       variant="grouped" | "stacked"      horizontal bars
//   CompositionBar  (single divided total bar)         the "one line" h-subtype
//   PieChart        variant="donut" | "pie"            part-to-whole
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
export { ChartTooltipContent } from "@/components/charts/ChartTooltip";
export { ChartLegend, SliceLegend } from "@/components/charts/ChartLegend";
export type { ChartDatum, ChartSeries, ChartSlice } from "@/components/charts/types";
export {
  CHART,
  CATEGORICAL,
  CHART_ANIMATION,
  MARK,
  tooltipWrapperClass,
  tooltipLabelClass,
  tooltipValueClass,
} from "@/components/charts/theme";
export { compactNumber, formatNumber, formatShare } from "@/components/charts/format";
