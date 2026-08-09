"use client";

import { useState, type ReactNode } from "react";
import { Cell, Pie, PieChart as RPieChart, Sector, Tooltip } from "recharts";
import type { PieSectorDataItem } from "recharts";
import { infoTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import {
  CHART,
  CHART_ANIMATION,
  MARK,
  dimmableClass,
  dimmedClass,
  tooltipLabelClass,
  tooltipValueClass,
  tooltipWrapperClass,
} from "@/components/charts/theme";
import { formatNumber, formatShare } from "@/components/charts/format";
import { resolveSliceColor, useReducedMotion } from "@/components/charts/internal";
import { SliceLegend } from "@/components/charts/ChartLegend";
import type { ChartSlice } from "@/components/charts/types";

// Part-to-whole at a glance. Subtypes via `variant`:
//   "donut" (default) — ring with the headline total in the hole.
//   "pie"             — full disc.
// Slices start at 12 o'clock, carry 2px surface gaps, and lift slightly on
// hover (hovering a slice or its legend row recedes the rest). Identity is
// monochrome-first (ink → greys → blue); the tail beyond `maxSlices` folds
// into the de-emphasised "Other" automatically, which is also where the
// distinguishable slots run out. The legend lists every value and share in
// plain sight — a pie never asks the reader to compare angles.

export interface PieChartProps {
  items: ChartSlice[];
  variant?: "donut" | "pie";
  /** Diameter of the plot in px (the chart box is a fixed square). */
  size?: number;
  /** Fold slices beyond this count into "Other" (4 auto colours + Other). */
  maxSlices?: number;
  valueFormatter?: (value: number) => string;
  /** Replaces the centre readout (donut only); null hides it. */
  center?: ReactNode;
  showLegend?: boolean;
  animate?: boolean;
  ariaLabel?: string;
  className?: string;
}

/** Keep the biggest (maxSlices - 1) parts in their given order; sum the rest. */
function foldTail(items: ChartSlice[], maxSlices: number): ChartSlice[] {
  if (items.length <= maxSlices) return items;
  const keep = new Set(
    [...items]
      .sort((a, b) => b.value - a.value)
      .slice(0, maxSlices - 1),
  );
  const kept = items.filter((item) => keep.has(item));
  const other = items
    .filter((item) => !keep.has(item))
    .reduce((sum, item) => sum + item.value, 0);
  return [...kept, { label: "Other", value: other, color: CHART.other }];
}

function SliceTooltip({
  active,
  payload,
  total,
  valueFormatter,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  total: number;
  valueFormatter: (value: number) => string;
}) {
  const slice = payload?.[0]?.payload as ChartSlice | undefined;
  if (!active || !slice) return null;
  return (
    <div className={cn(tooltipWrapperClass, "chart-tip-enter")}>
      <p className={tooltipLabelClass}>{slice.label}</p>
      <p className={tooltipValueClass}>
        {valueFormatter(slice.value)}
        <span className={cn(tooltipLabelClass, "ml-1.5")}>
          {formatShare(slice.value, total)}
        </span>
      </p>
    </div>
  );
}

export function PieChart({
  items,
  variant = "donut",
  size = 224,
  maxSlices = 5,
  valueFormatter = formatNumber,
  center,
  showLegend = true,
  animate = true,
  ariaLabel = "Proportional breakdown",
  className,
}: PieChartProps) {
  const reducedMotion = useReducedMotion();
  // Hovering a slice (or its legend row) keeps it at full strength while the
  // rest recede — identity stays traceable without colour-matching.
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const slices = foldTail(items, maxSlices);
  const colors = slices.map((slice, i) => resolveSliceColor(slice, i));
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0);
  const donut = variant === "donut";

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-6 sm:flex-row sm:justify-center",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <RPieChart width={size} height={size}>
          <Tooltip
            content={({ active, payload }) => (
              <SliceTooltip
                active={active}
                payload={payload}
                total={total}
                valueFormatter={valueFormatter}
              />
            )}
          />
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            startAngle={90}
            endAngle={-270}
            innerRadius={donut ? "62%" : 0}
            outerRadius="88%"
            stroke={CHART.surface}
            strokeWidth={MARK.surfaceGap}
            cornerRadius={donut ? 3 : 0}
            // The hovered slice lifts a touch — the mark responds to the reader.
            activeShape={(props: PieSectorDataItem) => (
              <Sector {...props} outerRadius={Number(props.outerRadius ?? 0) + 4} />
            )}
            isAnimationActive={animate && !reducedMotion}
            animationDuration={CHART_ANIMATION.duration}
            // No animationEasing override: recharts 3.9's "ease-out" leaves pie
            // arcs ~15% short of closing (cartesian marks settle fine). The
            // default easing completes the sweep exactly.
            onMouseEnter={(_, index) => setHighlighted(index)}
            onMouseLeave={() => setHighlighted(null)}
          >
            {slices.map((slice, i) => (
              <Cell
                key={slice.label}
                fill={colors[i]}
                className={cn(
                  dimmableClass,
                  highlighted !== null && highlighted !== i && dimmedClass,
                )}
              />
            ))}
          </Pie>
        </RPieChart>
        {donut && center !== null && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {center ?? (
              <>
                <span className={infoTextClass}>Total</span>
                <span className="text-lg font-semibold text-foreground">
                  {valueFormatter(total)}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {showLegend && (
        <SliceLegend
          slices={slices}
          colors={colors}
          total={total}
          valueFormatter={valueFormatter}
          onHighlight={setHighlighted}
          className="min-w-0"
        />
      )}
    </div>
  );
}
