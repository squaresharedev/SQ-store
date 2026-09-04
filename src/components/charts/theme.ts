// Shared styling tokens for every chart in the app (components/charts kit +
// the bespoke analytics charts). Every colour and text style comes from the
// semantic CSS variables in globals.css (styles.md §0: token first, then use)
// — chart components never hardcode a hex value. Numeric props Recharts
// requires (fontSize, strokeWidth, radii, durations) live here too so all
// charts stay visually consistent.

export const CHART = {
  /** Hairline grid — solid, one shade off the surface, recessive. */
  gridStroke: "var(--border)",
  /** Axis tick text: quiet, 12px, muted (styles.md §5 caption tier). */
  axisTick: { fill: "var(--muted-foreground)", fontSize: 12 },
  /** Neutral emphasis ramp — accent first, then progressively quieter
   *  (globals.css --chart-*). For single-series and semantic uses; multi-series
   *  identity comes from CATEGORICAL below. */
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
  /** Ink for a lone series — near-black, matching "black is the action colour". */
  ink: "var(--chart-1)",
  /** The one chromatic accent (blue) — a deliberate highlight, never filler. */
  accent: "var(--chart-accent)",
  /** The surface charts sit on; used for the 2px gaps between touching fills
   *  and the ring around overlapping markers (white does the separating —
   *  never a contrasting stroke). */
  surface: "var(--card)",
  /** De-emphasis fill for folded "Other" slices and series past the slots. */
  other: "var(--chart-4)",
} as const;

/** Series slots — monochrome first, hue on occasion. Ink carries the primary
 *  series, greys carry context (identity via lightness, the calm Vercel-style
 *  read), blue enters as the 4th slot or a pinned highlight, and green/red
 *  close the list so they are reached by PINNING (colorIndex 4/5) for
 *  good/bad meaning rather than by default. FIXED order — never re-sort by
 *  rank; past the slots, fold into "Other". */
export const CATEGORICAL = [
  "var(--chart-1)", /* ink */
  "var(--chart-2)", /* grey */
  "var(--chart-3)", /* light grey */
  "var(--chart-accent)", /* blue */
  "var(--chart-positive)", /* green — semantic, pin deliberately */
  "var(--chart-negative)", /* red — semantic, pin deliberately */
] as const;

/** Motion constants. Entrance is the one novel moment (600ms ease-out);
 *  everything high-frequency (tooltip glide, hover dims) sits in the
 *  120–220ms micro band so the chart feels alive, never laggy. Charts honour
 *  prefers-reduced-motion via useReducedMotion(). */
export const CHART_ANIMATION = {
  duration: 600,
  easing: "ease-out",
} as const;

/**
 * Tooltip presentation. It does NOT animate, and that is the whole point.
 *
 * Recharts' position animation tweens the readout from the container's own
 * origin to the pointer, so the first hover of a session visibly launches a
 * card from the chart's top-left corner and flies it to the cursor. There is
 * no reading of that which is correct: a tooltip belongs at the pointer the
 * instant the pointer is somewhere, and a 100ms flight across the card is time
 * spent looking at travel instead of at the number. `isAnimationActive={false}`
 * on every Tooltip, and no entrance keyframe on the body either.
 *
 * `wrapperStyle` carries the stacking. Recharts renders the readout as a
 * positioned sibling of the plot, so without a z-index it competes with
 * neighbouring cards on DOM order alone and slides UNDER the next chart down
 * the page. z-40 is the dropdown tier (the same one popovers and menus use):
 * above page content, deliberately below modals (z-50), the search overlay
 * (z-[60]) and toasts (z-[70]), none of which a hover readout should cover.
 */
export const TOOLTIP = {
  animated: false,
  wrapperStyle: { zIndex: 40, outline: "none" },
} as const;

/** Tailwind classes for the hover dim: the highlighted series stays at full
 *  strength while siblings recede, as a smooth interruptible fade. */
export const dimmableClass = "transition-opacity duration-base ease-standard";
export const dimmedClass = "opacity-25";

/** Mark specs (marks stay thin; the data is the only thing allowed to be loud). */
export const MARK = {
  /** Bars never exceed this thickness — the band's leftover space is air. */
  maxBarSize: 24,
  /** Rounded data-end radius; the baseline end stays square. */
  barRadius: 4,
  /** Line stroke width. */
  lineWidth: 2,
  /** Gap between touching fills (stacked segments, pie slices), in px. */
  surfaceGap: 2,
} as const;

// Custom tooltip chrome (Recharts `content={...}` — never the default
// tooltip). Popover-styled per styles.md: token surfaces, hairline border,
// soft shadow.

export const tooltipWrapperClass =
  "bg-popover border border-border rounded-md shadow-md px-3 py-2";
export const tooltipLabelClass = "font-inter text-xs text-muted-foreground";
/** tabular-nums: digits keep their width while the tooltip glides across
 *  points, so values tick over without jitter. */
export const tooltipValueClass = "text-sm font-semibold text-foreground tabular-nums";

// Legend chrome — the swatch-dot + quiet-text rows used across the app
// (StatusBreakdown / ChannelSplit idiom). Text wears text tokens, never the
// series colour; the dot beside it carries identity.

export const legendRowClass = "flex items-center gap-2";
export const legendSwatchClass = "size-2 shrink-0 rounded-full";
export const legendLabelClass = "font-inter text-sm text-foreground";
export const legendMetaClass = "font-inter text-sm text-muted-foreground";
