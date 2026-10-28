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
  /** The same job for a chart that sits on the page itself, not in a card. */
  page: "var(--background)",
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
 * Tooltip presentation. RECHARTS' OWN animation stays off, and the readout's
 * motion is ours instead (globals.css, "Chart readouts ARRIVE IN PLACE").
 *
 * Recharts' position animation tweens the readout from the container's own
 * origin to the pointer, so the first hover of a session visibly launches a
 * card from the chart's top-left corner and flies it to the cursor. There is
 * no reading of that which is correct: a tooltip belongs at the pointer the
 * instant the pointer is somewhere. So `isAnimationActive={false}` on every
 * Tooltip, always. What makes the readout feel smooth instead of snappy is an
 * entrance played where it already stands (`chart-tip-enter`, on the body),
 * and a short glide between points that only begins once it has been placed.
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

/** How far a hovered pie slice reaches: its OUTER edge eases out to this
 *  multiple of its radius while the inner edge stays put, so the slice grows
 *  where it stands instead of moving. Its neighbours are left exactly as they
 *  are (no dim). */
export const SLICE_GROW = 1.1;

/** Mark specs (marks stay thin; the data is the only thing allowed to be loud). */
export const MARK = {
  /** Bars never exceed this thickness — the band's leftover space is air. */
  maxBarSize: 24,
  /** Rounded data-end radius; the baseline end stays square. */
  barRadius: 4,
  /** The least a bar with ANY value is drawn at, in px. Beside a bar a
   *  million times its size, a real value would otherwise round to no bar at
   *  all and read as "nothing". A zero still draws nothing. */
  minBar: 2,
  /** Line stroke width. */
  lineWidth: 2,
  /** Gap between touching fills (stacked segments, pie slices), in px. */
  surfaceGap: 2,
  /** Opacity of an area's wash where it meets its line; it fades to nothing. */
  areaWash: 0.12,
  /** The opacity the wash as a whole is drawn at (Recharts' own default for
   *  an area, pinned here so anything drawn to MATCH a wash can match it). */
  areaFillOpacity: 0.6,
  /** A reference series (ChartSeries.reference): thinner than a measured line
   *  and dashed, so it reads as context. */
  referenceWidth: 1.5,
  referenceDash: "4 4",
  /** A series with ONE value has no line to draw. Its point is marked, and a
   *  faint dotted level runs through it so the value can be read off the axis. */
  loneDotRadius: 5,
  loneLevelDash: "2 4",
  loneLevelOpacity: 0.5,
} as const;

/** Plot geometry the cartesian charts share, in px. */
export const PLOT = {
  /** Air above the plot, so the top gridline is never clipped. */
  top: 8,
  /** Air right of the plot, so the last point's hover dot is never clipped. */
  right: 8,
  /** The band under the plot that holds the category labels. */
  xAxisHeight: 30,
} as const;

/**
 * Edge-to-edge ("bleed") plots: a chart drawn on the page itself, running the
 * full width of its box, with no card around it and no axis column beside it.
 * The value labels move INSIDE the plot and sit on their gridlines, and the
 * plot dissolves at both ends instead of being cut off by the box's edges.
 *
 * WHAT DISSOLVES IS NOT DATA. The first and last values stand clear of both
 * ends, drawn at full strength. From each of them a TAIL runs on, level, to
 * the edge of the box, and it is the tail that blurs away. So the graph still
 * reaches from one side of the screen to the other, and nothing a reader
 * needs is ever in the blur.
 */
export const BLEED = {
  /** How far labels stand in from the box's edges. The page gutter (px-6), so
   *  a bled chart's labels line up with the column of cards under it. */
  inset: 24,
  /** Air above the plot: room for the top value label, which sits on its
   *  gridline instead of beside it. */
  top: 20,
  /** How far a value label is lifted to sit on its gridline. */
  labelLift: 6,
  /** The width given to the value axis. It takes no room (it is drawn inside
   *  the plot), but Recharts draws no labels at all for an axis of no width. */
  axisBox: 44,
  /** Page-coloured outline around a value label, so the line can pass behind
   *  it and the label still reads. */
  labelHalo: 4,
  /** A stronger wash than MARK.areaWash: with no card to frame it, the fill
   *  is what gives the chart its body. */
  areaWash: 0.2,
  /** How much of the width each end's tail takes, as a share of it, and the
   *  least and most that may come to in px (a phone still needs a visible
   *  tail; a wide monitor does not need a huge one). */
  fade: 0.08,
  fadeMin: 32,
  fadeMax: 112,
  /** How far along a tail its sharp copy has given way to its blurred one,
   *  as a share of the tail: the line goes out of focus first, then away. */
  blurBy: 0.5,
  /** The blur's radius, in px. */
  blur: 4,
} as const;

/** The width of each end's tail, in px, for a bled plot `width` px wide. */
export function bleedFade(width: number): number {
  return Math.round(Math.min(BLEED.fadeMax, Math.max(BLEED.fadeMin, width * BLEED.fade)));
}

/** Where a bled plot sits inside a chart of `height`: its top edge and its own
 *  height, in px. For a caller laying something over the plot. */
export function bleedPlot(height: number): { top: number; height: number } {
  return { top: BLEED.top, height: height - BLEED.top - PLOT.xAxisHeight };
}

// Custom tooltip chrome (Recharts `content={...}` — never the default
// tooltip). Popover-styled per styles.md: token surfaces, hairline border,
// soft shadow.

export const tooltipWrapperClass =
  "chart-tip-enter bg-popover border border-border rounded-md shadow-md px-3 py-2";
export const tooltipLabelClass = "font-inter text-xs text-muted-foreground";
/** tabular-nums: digits keep their width while the tooltip glides across
 *  points, so values tick over without jitter. */
export const tooltipValueClass = "text-sm font-semibold text-foreground tabular-nums";

// Legend chrome — the swatch-dot + quiet-text rows used across the app
// (StatusBreakdown / ChannelSplit idiom). Text wears text tokens, never the
// series colour; the dot beside it carries identity.

export const legendRowClass = "flex items-center gap-2";
export const legendSwatchClass = "size-2 shrink-0 rounded-full";
/** `wrap-anywhere`: a label is a product's or a shop's own name, and one with
 *  no space in it has to give way to the value beside it, not push it out. */
export const legendLabelClass = "font-inter text-sm text-foreground wrap-anywhere";
export const legendMetaClass = "font-inter text-sm text-muted-foreground";

/** A part-to-whole legend row (SliceLegend). Padded into the gutter so the
 *  highlight band can land without the text moving. */
export const sliceLegendRowClass =
  "-mx-2 flex items-center gap-3 px-2 py-1 transition-colors duration-base ease-standard motion-reduce:transition-none";
/** The row of the part being hovered (in the plot or the legend): the accent
 *  the dashboard's hovered rows wear. */
export const sliceLegendRowActiveClass = "bg-accent";
