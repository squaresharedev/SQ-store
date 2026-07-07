// Shared Recharts styling tokens for the analytics charts. Every colour and
// text style comes from the semantic CSS variables in globals.css (styles.md
// §2/§5) — the chart components never hardcode a hex value. Numeric props
// Recharts requires (fontSize, strokeWidth, radii) live here too so the three
// charts stay visually consistent.

export const CHART = {
  /** Hairline horizontal grid only — no chart junk. */
  gridStroke: "var(--border)",
  /** Axis tick text: quiet, 12px, muted (styles.md §5 caption tier). */
  axisTick: { fill: "var(--muted-foreground)", fontSize: 12 },
  /** Series ramp — accent first, then progressively quieter (globals.css
   *  --chart-*). Use in order; never invent an off-ramp colour. */
  series1: "var(--chart-1)",
  series2: "var(--chart-2)",
  series3: "var(--chart-3)",
  series4: "var(--chart-4)",
  /** Semantic feedback series: healthy green / refund red. */
  positive: "var(--chart-positive)",
  negative: "var(--chart-negative)",
  /** Back-compat aliases (the original two-colour charts). */
  seriesPrimary: "var(--chart-1)",
  seriesMuted: "var(--chart-3)",
} as const;

// Custom tooltip chrome (Recharts `content={...}` — never the default
// tooltip). Popover-styled per styles.md: token surfaces, hairline border,
// soft shadow.

export const tooltipWrapperClass =
  "bg-popover border border-border rounded-md shadow-md px-3 py-2";
export const tooltipLabelClass = "font-inter text-xs text-muted-foreground";
export const tooltipValueClass = "text-sm font-semibold text-foreground";
