"use client";

import { cn } from "@/lib/utils";
import {
  legendLabelClass,
  legendMetaClass,
  legendRowClass,
  legendSwatchClass,
} from "@/components/charts/theme";
import { formatNumber, formatShare } from "@/components/charts/format";
import type { ChartSlice, ResolvedSeries } from "@/components/charts/types";

// Legends are plain HTML below the plot (wraps cleanly, real text for a11y).
// A legend renders for two or more series — the dependable identity channel —
// and never for one (the card title already names a lone series). Hovering a
// row highlights its series in the plot so readers can trace identity without
// colour-matching.

export function ChartLegend({
  series,
  onHighlight,
  className,
}: {
  series: ResolvedSeries[];
  /** Called with the hovered series key, and null on leave. */
  onHighlight?: (key: string | null) => void;
  className?: string;
}) {
  if (series.length < 2) return null;
  return (
    <ul className={cn("mt-3 flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {series.map((s) => (
        <li
          key={s.key}
          className={legendRowClass}
          onMouseEnter={() => onHighlight?.(s.key)}
          onMouseLeave={() => onHighlight?.(null)}
        >
          <span
            aria-hidden
            className={legendSwatchClass}
            style={{ backgroundColor: s.resolvedColor }}
          />
          <span className={cn(legendLabelClass, "text-muted-foreground")}>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Part-to-whole legend (pie slices, composition segments): every row shows
 *  its value and share in plain sight, so the numbers are never hover-gated.
 *  Hovering a row highlights its part in the plot (the reverse of hovering
 *  the mark), keeping identity traceable without colour-matching. */
export function SliceLegend({
  slices,
  colors,
  total,
  valueFormatter = formatNumber,
  onHighlight,
  className,
}: {
  slices: ChartSlice[];
  /** Display colour per slice, index-aligned. */
  colors: string[];
  total: number;
  valueFormatter?: (value: number) => string;
  /** Called with the hovered slice index, and null on leave. */
  onHighlight?: (index: number | null) => void;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {slices.map((slice, i) => (
        <li
          key={slice.label}
          className="flex items-center gap-3"
          onMouseEnter={() => onHighlight?.(i)}
          onMouseLeave={() => onHighlight?.(null)}
        >
          <span
            aria-hidden
            className={legendSwatchClass}
            style={{ backgroundColor: colors[i] }}
          />
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <span className={legendLabelClass}>{slice.label}</span>
            <span className="font-inter text-sm whitespace-nowrap tabular-nums">
              <span className="font-semibold text-foreground">
                {valueFormatter(slice.value)}
              </span>
              <span className={cn(legendMetaClass, "ml-2")}>
                {formatShare(slice.value, total)}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
