"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";

// A chart to scrub: move along it and the parent hears which day is under the
// pointer, so the headline figure can read that day out (the way Stripe and
// Mercury do). Area, line, step or bars over one series, with an optional
// dashed comparison line. "hatch" is the area with diagonal rules instead of
// a wash (after Polar). Prototype for the payments lab; the winner moves
// into components/charts.

export type ScrubChartStyle = "area" | "hatch" | "line" | "step" | "bars";

/** A smooth path through points (monotone cubic, so it never overshoots a value). */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  const n = points.length;
  const dx = (i: number) => points[i + 1][0] - points[i][0];
  const slope = (i: number) => (points[i + 1][1] - points[i][1]) / dx(i);
  // d3's monotoneX tangents, for evenly spaced points.
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

function stepPath(points: [number, number][]): string {
  return points.reduce((d, [x, y], i) => (i === 0 ? `M${x},${y}` : `${d}H${x}V${y}`), "");
}

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

export function ScrubChart({
  values,
  compare,
  style = "area",
  color = "currentColor",
  compareColor,
  height = 160,
  fillOpacity = 0.22,
  strokeWidth = 2,
  baseline = true,
  grid = false,
  glow = false,
  active,
  onScrub,
  className,
  ariaLabel,
}: {
  values: number[];
  /** A second series to read against (the previous period), drawn dashed. */
  compare?: number[];
  style?: ScrubChartStyle;
  color?: string;
  compareColor?: string;
  height?: number;
  fillOpacity?: number;
  strokeWidth?: number;
  /** A hairline along the floor. */
  baseline?: boolean;
  /** Faint horizontal guides. */
  grid?: boolean;
  /** A soft blur of the line under itself. */
  glow?: boolean;
  /** The index being read out, if the parent holds it. */
  active?: number | null;
  onScrub?: (index: number | null) => void;
  className?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const [own, setOwn] = useState<number | null>(null);
  const current = active === undefined ? own : active;
  const n = values.length;
  const pad = strokeWidth + 4;
  const all = [...values, ...(compare ?? [])];
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const y = (v: number) => pad + (height - pad * 2) * (1 - (v - min) / (max - min || 1));
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * width);
  const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
  const comparePts = compare?.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = style === "step" ? stepPath(pts) : smoothPath(pts);
  const floor = y(Math.max(min, 0));

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    if (!width || n === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(n - 1, Math.round(((event.clientX - rect.left) / rect.width) * (n - 1))));
    setOwn(index);
    onScrub?.(index);
  };
  const leave = () => {
    setOwn(null);
    onScrub?.(null);
  };

  const barWidth = n > 0 ? Math.max(2, (width / n) * 0.62) : 0;

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      className={cn("relative touch-none select-none", className)}
      style={{ height }}
      onPointerMove={scrub}
      onPointerDown={scrub}
      onPointerLeave={leave}
    >
      {width > 0 && (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeOpacity={fillOpacity * 1.6} strokeWidth="1.5" />
            </pattern>
            <filter id={`${id}-glow`} x="-10%" y="-50%" width="120%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>
          {grid &&
            [0.25, 0.5, 0.75].map((t) => (
              <line key={t} x1={0} x2={width} y1={pad + (height - pad * 2) * t} y2={pad + (height - pad * 2) * t} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="2 4" />
            ))}
          {baseline && <line x1={0} x2={width} y1={floor} y2={floor} stroke="currentColor" strokeOpacity={0.12} />}

          {style === "bars" ? (
            values.map((v, i) => {
              const top = y(Math.max(v, 0));
              const bottom = y(Math.min(v, 0));
              const dim = current !== null && current !== i;
              return (
                <rect
                  key={i}
                  x={x(i) - barWidth / 2}
                  y={top}
                  width={barWidth}
                  height={Math.max(v === 0 ? 0 : 2, bottom - top)}
                  rx={Math.min(3, barWidth / 2)}
                  fill={color}
                  opacity={dim ? 0.35 : v < 0 ? 0.45 : 1}
                  className="transition-opacity duration-fast"
                />
              );
            })
          ) : (
            <>
              {comparePts && comparePts.length > 1 && (
                <path d={style === "step" ? stepPath(comparePts) : smoothPath(comparePts)} fill="none" stroke={compareColor ?? "currentColor"} strokeOpacity={compareColor ? 1 : 0.28} strokeWidth={1.5} strokeDasharray="4 4" />
              )}
              {(style === "area" || style === "hatch") && pts.length > 1 && (
                <path d={`${line}L${pts[n - 1][0]},${floor}L${pts[0][0]},${floor}Z`} fill={`url(#${id}-${style === "hatch" ? "hatch" : "fill"})`} />
              )}
              {glow && <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth * 3} strokeOpacity={0.35} filter={`url(#${id}-glow)`} />}
              <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}

          {current !== null && pts[current] && (
            <>
              <line x1={pts[current][0]} x2={pts[current][0]} y1={0} y2={height} stroke="currentColor" strokeOpacity={0.25} strokeDasharray="3 3" />
              {style !== "bars" && (
                <circle cx={pts[current][0]} cy={pts[current][1]} r={4.5} fill={color} stroke="white" strokeWidth={2} />
              )}
            </>
          )}
        </svg>
      )}
    </div>
  );
}
