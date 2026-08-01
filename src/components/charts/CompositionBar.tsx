"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  tooltipLabelClass,
  tooltipValueClass,
  tooltipWrapperClass,
} from "@/components/charts/theme";
import { formatNumber, formatShare } from "@/components/charts/format";
import { resolveSliceColor } from "@/components/charts/internal";
import { SliceLegend } from "@/components/charts/ChartLegend";
import type { ChartSlice } from "@/components/charts/types";

// The "one line" horizontal subtype: a single bar that IS the total, divided
// into sections proportional to each part (order mix, storage used, revenue
// by channel). Token-styled divs, not SVG — segments keep pixel-perfect 2px
// surface gaps at any width, and each one is keyboard-focusable with the same
// readout shown on hover. Sections grow into place on mount, the hovered or
// focused section swells slightly while its siblings recede, and the legend
// beneath carries every value and share in plain sight, so nothing is
// hover-gated.

export interface CompositionBarProps {
  items: ChartSlice[];
  /** Bar thickness in px. */
  thickness?: number;
  /** Pill ends (default) — pass false for the sharp square-identity look. */
  rounded?: boolean;
  valueFormatter?: (value: number) => string;
  showLegend?: boolean;
  animate?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function CompositionBar({
  items,
  thickness = 12,
  rounded = true,
  valueFormatter = formatNumber,
  showLegend = true,
  animate = true,
  ariaLabel = "Composition",
  className,
}: CompositionBarProps) {
  // `active` (segment hover/focus) drives the readout; the legend only dims.
  const [active, setActive] = useState<number | null>(null);
  const [legendActive, setLegendActive] = useState<number | null>(null);

  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
  const colors = items.map((item, i) => resolveSliceColor(item, i));
  const highlighted = active ?? legendActive;

  // Zero-value parts stay in the legend but render no segment.
  const visible =
    total > 0
      ? items.map((item, index) => ({ item, index })).filter(({ item }) => item.value > 0)
      : [];
  const widths = visible.map(({ item }) => (item.value / total) * 100);
  const segments = visible.map((entry, i) => {
    const start = widths.slice(0, i).reduce((sum, w) => sum + w, 0);
    return { ...entry, width: widths[i], center: start + widths[i] / 2 };
  });

  const activeSegment = active === null ? null : (segments.find((s) => s.index === active) ?? null);

  return (
    <div className={cn("w-full", className)} role="group" aria-label={ariaLabel}>
      <div className="relative">
        {/* Floating readout anchored over the hovered/focused segment. */}
        {activeSegment && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${activeSegment.center}%` }}
            role="status"
          >
            <div className={cn(tooltipWrapperClass, "chart-tip-enter")}>
              <p className={tooltipLabelClass}>{activeSegment.item.label}</p>
              <p className={tooltipValueClass}>
                {valueFormatter(activeSegment.item.value)}
                <span className={cn(tooltipLabelClass, "ml-1.5")}>
                  {formatShare(activeSegment.item.value, total)}
                </span>
              </p>
            </div>
          </div>
        )}

        <div className="flex w-full gap-0.5" style={{ height: thickness }}>
          {segments.map(({ item, index, width }, position) => {
            const dimmed = highlighted !== null && highlighted !== index;
            const swollen = highlighted === index;
            return (
              <span
                key={item.label}
                role="img"
                aria-label={`${item.label}: ${valueFormatter(item.value)} (${formatShare(item.value, total)})`}
                tabIndex={0}
                className={cn(
                  "h-full min-w-1 outline-none",
                  "transition-[transform,opacity] duration-base ease-standard motion-reduce:transition-none",
                  animate && "chart-seg-enter",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                  rounded && position === 0 && "rounded-l-full",
                  rounded && position === segments.length - 1 && "rounded-r-full",
                )}
                style={{
                  width: `${width}%`,
                  backgroundColor: colors[index],
                  opacity: dimmed ? 0.4 : 1,
                  transform: swollen ? "scaleY(1.2)" : undefined,
                }}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            );
          })}
          {total <= 0 && (
            <span
              className={cn("h-full w-full bg-muted", rounded && "rounded-full")}
              aria-hidden
            />
          )}
        </div>
      </div>

      {showLegend && (
        <SliceLegend
          slices={items}
          colors={colors}
          total={total}
          valueFormatter={valueFormatter}
          onHighlight={setLegendActive}
          className="mt-4"
        />
      )}
    </div>
  );
}
