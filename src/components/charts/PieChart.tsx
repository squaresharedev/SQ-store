"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { animate, motionValue, useMotionValueEvent, type MotionValue } from "motion/react";
import { Cell, Pie, PieChart as RPieChart, Sector, Tooltip } from "recharts";
import type { PieSectorShapeProps } from "recharts";
import { infoTextClass } from "@/components/ui/control-styles";
import { DURATION, EASE_STANDARD } from "@/components/ui/motion-tokens";
import { cn } from "@/lib/utils";
import { FitText } from "@/components/ui/FitText";
import {
  CHART,
  CHART_ANIMATION,
  MARK,
  SLICE_GROW,
  TOOLTIP,
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
// Slices start at 12 o'clock and carry 2px surface gaps. The one hovered (or
// whose legend row is hovered) grows outward in place and its legend row
// lights up; the rest are left alone, and nothing floats over the plot to
// cover the slice the reader is moving to. Identity is
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
function foldTail(
  items: ChartSlice[],
  maxSlices: number,
  otherLabel: string,
): ChartSlice[] {
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
  return [...kept, { label: otherLabel, value: other, color: CHART.other }];
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
  const locale = useLocale();
  const slice = payload?.[0]?.payload as ChartSlice | undefined;
  if (!active || !slice) return null;
  return (
    <div className={tooltipWrapperClass}>
      <p className={tooltipLabelClass}>{slice.label}</p>
      <p className={tooltipValueClass}>
        {valueFormatter(slice.value)}
        <span className={cn(tooltipLabelClass, "ml-1.5")}>
          {formatShare(slice.value, total, locale)}
        </span>
      </p>
    </div>
  );
}

/**
 * How far each slice has grown, 0 at rest to 1 fully grown, eased towards the
 * hovered one. Held HERE, above Recharts, not in the slices: Recharts keys its
 * sector animation on the Pie's whole props object, so every re-render (each
 * hover change among them) remounts the sectors, and a slice that kept its own
 * progress would lose it mid-grow and jump.
 */
function useSliceGrowth(
  count: number,
  grown: number | null,
  instant: boolean,
): MotionValue<number>[] {
  const growth = useMemo(() => Array.from({ length: count }, () => motionValue(0)), [count]);
  useEffect(() => {
    const transition = instant
      ? { duration: 0 }
      : { duration: DURATION.base, ease: EASE_STANDARD };
    const controls = growth.map((value, i) => animate(value, i === grown ? 1 : 0, transition));
    return () => controls.forEach((control) => control.stop());
  }, [growth, grown, instant]);
  return growth;
}

/**
 * One slice, drawn through the Pie's `shape` hook. Its OUTER edge reaches out
 * by `growth` (up to SLICE_GROW times its radius); the inner edge never moves,
 * so the slice grows where it stands rather than shifting. Only this slice
 * re-renders while it animates, and a remounted one picks up mid-way.
 */
function PieSlice({ growth, ...props }: PieSectorShapeProps & { growth?: MotionValue<number> }) {
  const [step, setStep] = useState(() => growth?.get() ?? 0);
  useMotionValueEvent(growth ?? REST, "change", setStep);
  const outer = Number(props.outerRadius ?? 0);
  return <Sector {...props} outerRadius={outer * (1 + (SLICE_GROW - 1) * step)} />;
}

/** Stands in for a slice with no growth value of its own (never animates). */
const REST = motionValue(0);

export function PieChart({
  items,
  variant = "donut",
  size = 224,
  maxSlices = 5,
  valueFormatter: valueFormatterProp,
  center,
  showLegend = true,
  animate = true,
  ariaLabel: ariaLabelProp,
  className,
}: PieChartProps) {
  const t = useTranslations("Common.charts");
  const locale = useLocale();
  const valueFormatter =
    valueFormatterProp ?? ((value: number) => formatNumber(value, locale));
  const ariaLabel = ariaLabelProp ?? t("proportional");
  const reducedMotion = useReducedMotion();
  // Hovering a slice (or its legend row) grows that slice and marks its row,
  // and touches nothing else: identity stays traceable without
  // colour-matching, and the other parts stay as readable as they were.
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const slices = foldTail(items, maxSlices, t("other"));
  const colors = slices.map((slice, i) => resolveSliceColor(slice, i));
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0);
  const donut = variant === "donut";
  const growth = useSliceGrowth(slices.length, highlighted, reducedMotion);

  return (
    <div
      className={cn(
        // Wraps by the room the CARD has, not the screen: beside the pie when
        // the legend fits there, under it when a long name or a six-figure
        // value does not (half a laptop's width is narrower than a phone).
        "flex flex-wrap items-center justify-center gap-6",
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <RPieChart width={size} height={size}>
          {/* The legend states every value and share and lights up the
              hovered slice's row, so a floating readout would only cover the
              slices the reader moves to next. Without a legend it is the only
              readout, so there it stays. */}
          {!showLegend && (
            <Tooltip
              isAnimationActive={TOOLTIP.animated}
              wrapperStyle={TOOLTIP.wrapperStyle}
              content={({ active, payload }) => (
                <SliceTooltip
                  active={active}
                  payload={payload}
                  total={total}
                  valueFormatter={valueFormatter}
                />
              )}
            />
          )}
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
            shape={(props: PieSectorShapeProps) => (
              <PieSlice {...props} growth={growth[props.index]} />
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
                data-slice-grown={highlighted === i ? "" : undefined}
              />
            ))}
          </Pie>
        </RPieChart>
        {donut && center !== null && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {center ?? (
              <>
                <span className={infoTextClass}>{t("total")}</span>
                {/* Half the chart wide, which is what the hole has room for at
                    its middle, and shrunk to fit: a nine-digit total would
                    otherwise run out over the ring on both sides. */}
                <span className="w-1/2 text-center text-lg font-semibold text-foreground">
                  <FitText measure={valueFormatter(total)}>{valueFormatter(total)}</FitText>
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
          highlighted={highlighted}
          className="min-w-0"
        />
      )}
    </div>
  );
}
