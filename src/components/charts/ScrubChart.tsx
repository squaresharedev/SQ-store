"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { BLEED, CHART, MARK } from "@/components/charts/theme";
import { cn } from "@/lib/utils";

// A chart to SCRUB: move along it and the caller hears which point is under
// the pointer, so a headline figure beside it can read that point out (the
// way Stripe and Mercury do), and goes back to the total when the pointer
// leaves. One series as a line over a fading wash, with an optional dashed
// comparison (the period before). Without `onScrub` it is a plain sparkline.
//
// Plain SVG rather than Recharts: it has no axes, tooltip or legend for the
// kit's components to own, and the readout is the caller's, not a popover.
// Its dates and figures live around it, in the caller's markup.
//
// TOUCH: `touch-pan-y`, so a finger moving across the chart scrubs it and one
// moving up or down still scrolls the page past it.
//
// GAPS. A null is a point with no value (an average over a day that sold
// nothing): it is not drawn, and the line runs straight on from the point
// before it to the point after, the way the kit's LineChart `connectNulls`
// does. Scrubbing still lands on it; what to say there is the caller's.
//
// ONE VALUE. A line needs two points. A series with a single value gets its
// point marked and a faint dotted level through it, as the kit's LineChart
// does, so a one-day range still shows what that day was.

/** A smooth path through evenly spaced points: a monotone cubic (d3's
 *  monotoneX), so the line never overshoots a value and never dips below a
 *  running total that only rises. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  const n = points.length;
  const dx = (i: number) => points[i + 1][0] - points[i][0];
  const slope = (i: number) => (points[i + 1][1] - points[i][1]) / dx(i);
  const tangents = points.map((_, i) => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const a = slope(i - 1);
    const b = slope(i);
    return (Math.sign(a) + Math.sign(b)) * Math.min(Math.abs(a), Math.abs(b), 0.5 * Math.abs((a + b) / 2));
  });
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const h = dx(i) / 3;
    d += `C${points[i][0] + h},${points[i][1] + tangents[i] * h} ${points[i + 1][0] - h},${points[i + 1][1] - tangents[i + 1] * h} ${points[i + 1][0]},${points[i + 1][1]}`;
  }
  return d;
}

/** The element's width, kept current as it resizes. Zero until measured. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Faint level guides, as shares of the plot's height from the top. */
const GUIDES = [0.25, 0.5, 0.75];

/** A series' values with its gaps left out. */
const valuesOf = (series: readonly (number | null)[] | null | undefined) =>
  (series ?? []).filter((value): value is number => value !== null);

export type ScrubChartProps = {
  /** One value per point, evenly spaced; null for a point with none (see GAPS). */
  values: (number | null)[];
  /** A second series to read against (the period before), drawn dashed. */
  compare?: (number | null)[] | null;
  /** The line and its wash. A CHART token. */
  color?: string;
  height?: number;
  strokeWidth?: number;
  /** A hairline along zero. */
  baseline?: boolean;
  /** Faint dotted level guides. */
  guides?: boolean;
  /** The point being read out, when the caller holds it. */
  active?: number | null;
  /** Makes the chart scrubbable: called with the point under the pointer,
   *  and with null when the pointer leaves. */
  onScrub?: (index: number | null) => void;
  className?: string;
  ariaLabel: string;
};

export function ScrubChart({
  values,
  compare,
  color = CHART.accent,
  height = 160,
  strokeWidth = MARK.lineWidth,
  baseline = true,
  guides = false,
  active = null,
  onScrub,
  className,
  ariaLabel,
}: ScrubChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const n = values.length;
  // Air around the plot, so the line and the scrub dot are never clipped.
  const pad = strokeWidth + MARK.scrubDotRadius;
  const all = [...valuesOf(values), ...valuesOf(compare)];
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / (max - min || 1));
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
  const pointsOf = (series: readonly (number | null)[]) =>
    series.flatMap((v, i) => (v === null ? [] : [[x(i), y(v)] as [number, number]]));
  const points = pointsOf(values);
  const comparePoints = compare ? pointsOf(compare) : undefined;
  const line = smoothPath(points);
  const floor = y(0);

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    if (!onScrub || n === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const share = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    onScrub(Math.max(0, Math.min(n - 1, Math.round(share * (n - 1)))));
  };
  const leave = () => onScrub?.(null);
  /** A lone point: its dot, and a dotted level across the plot. */
  const lone = (point: [number, number], fill: string, key: string) => (
    <g key={key} data-scrub-lone={key}>
      <line
        x1={0}
        x2={width}
        y1={point[1]}
        y2={point[1]}
        stroke={fill}
        strokeDasharray={MARK.loneLevelDash}
        strokeOpacity={MARK.loneLevelOpacity}
      />
      <circle
        cx={point[0]}
        cy={point[1]}
        r={MARK.loneDotRadius}
        fill={fill}
        stroke={CHART.surface}
        strokeWidth={MARK.surfaceGap}
      />
    </g>
  );
  const activeValue = active !== null ? values[active] : null;
  // On a gap the rule still follows the pointer; only the dot has nowhere to sit.
  const current = active !== null && active < n ? ([x(active), activeValue == null ? null : y(activeValue)] as const) : null;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      className={cn("relative select-none", onScrub && "touch-pan-y", className)}
      style={{ height }}
      onPointerMove={onScrub && scrub}
      onPointerDown={onScrub && scrub}
      onPointerLeave={onScrub && leave}
      onPointerCancel={onScrub && leave}
    >
      {width > 0 && (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={BLEED.areaWash} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {guides &&
            GUIDES.map((share) => {
              const level = pad + (height - pad * 2) * share;
              return (
                <line key={share} x1={0} x2={width} y1={level} y2={level} stroke={CHART.gridStroke} strokeDasharray={MARK.guideDash} />
              );
            })}
          {baseline && <line x1={0} x2={width} y1={floor} y2={floor} stroke={CHART.gridStroke} />}
          {comparePoints && comparePoints.length > 1 && (
            <path
              d={smoothPath(comparePoints)}
              fill="none"
              stroke={CHART.series3}
              strokeWidth={MARK.referenceWidth}
              strokeDasharray={MARK.referenceDash}
            />
          )}
          {points.length > 1 && (
            <path d={`${line}L${points[points.length - 1][0]},${floor}L${points[0][0]},${floor}Z`} fill={`url(#${id}-wash)`} />
          )}
          <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          {comparePoints?.length === 1 && lone(comparePoints[0], CHART.series3, "compare")}
          {points.length === 1 && lone(points[0], color, "values")}
          {current && (
            <>
              <line
                x1={current[0]}
                x2={current[0]}
                y1={0}
                y2={height}
                stroke={CHART.series3}
                strokeDasharray={MARK.crosshairDash}
              />
              {current[1] !== null && (
                <circle
                  cx={current[0]}
                  cy={current[1]}
                  r={MARK.scrubDotRadius}
                  fill={color}
                  stroke={CHART.surface}
                  strokeWidth={MARK.surfaceGap}
                />
              )}
            </>
          )}
        </svg>
      )}
    </div>
  );
}
