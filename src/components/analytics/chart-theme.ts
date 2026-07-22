// Chart styling tokens now live with the reusable kit (components/charts) so
// the bespoke analytics charts and the generic components share one source.
// This module stays as the analytics-local import path.

export {
  CHART,
  tooltipWrapperClass,
  tooltipLabelClass,
  tooltipValueClass,
} from "@/components/charts/theme";
