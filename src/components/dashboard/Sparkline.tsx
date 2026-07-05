import { cn } from "@/lib/utils";
import type { TrendTone } from "@/lib/dashboard/queries";

// Direction -> stroke colour. Green up / red down / grey flat, plus the reserved
// acid-purple "surge" (10x) — the one deliberate purple moment on this card.
const TONE_CLASS: Record<TrendTone, string> = {
  up: "text-success",
  down: "text-destructive",
  flat: "text-muted-foreground",
  surge: "text-acid",
};

/**
 * A bare trend line — no axes, dots, or labels, just the stroke plus a soft
 * fill beneath it that fades from the line's colour down to nothing at the
 * baseline (the shared "0 line"). Colour encodes period-over-period direction
 * (see `TrendTone`). A pure function of `points`, so it server-renders with no
 * hydration risk.
 *
 * The viewBox is stretched to the box (`preserveAspectRatio="none"`) while the
 * stroke stays a crisp 2px via `vectorEffect="non-scaling-stroke"`.
 */
export function Sparkline({
  points,
  tone,
  className,
}: {
  points: number[];
  tone: TrendTone;
  className?: string;
}) {
  if (points.length < 2) return null;

  const width = 100;
  const height = 32;
  const pad = 2; // keep the rounded stroke off the top/bottom edges
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const stepX = (width - pad * 2) / (points.length - 1);

  const coords = points.map((value, i) => {
    const x = pad + i * stepX;
    // Flat series (range 0) sits on the centre line rather than the floor.
    const y =
      range === 0
        ? height / 2
        : pad + (height - pad * 2) * (1 - (value - min) / range);
    return [x, y] as const;
  });

  const line = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const firstX = coords[0][0];
  const lastX = coords[coords.length - 1][0];
  // Close the line down to the common baseline and back — the fade's footprint.
  const area = `${line} L${lastX.toFixed(2)} ${height} L${firstX.toFixed(2)} ${height} Z`;

  // Colour-agnostic (stops use currentColor); one def per tone is enough.
  const gradientId = `sparkline-fade-${tone}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      className={cn(TONE_CLASS[tone], className)}
    >
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1={pad}
          x2="0"
          y2={height}
        >
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={line}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
