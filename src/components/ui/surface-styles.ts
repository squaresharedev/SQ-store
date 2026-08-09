// Shared SURFACE + PAGE class strings, the counterpart to control-styles.ts:
// that file owns things you interact with (buttons, fields, overlays), this one
// owns the boxes they sit in and the page furniture around them. Every value is
// a token — radius from the styles.md scale (globals.css @theme), colors
// semantic, motion from the motion scale.
//
// Import these rather than re-spelling a card or a page header: one edit here
// changes every surface in the product at once, which is the whole point.

/**
 * Content card (styles.md §6.1: border first, shadow sparingly). Padding is
 * deliberately NOT included — a metric tile, a chart card and a list card each
 * want their own room, and that is the only thing they should differ by.
 */
export const cardClass = "rounded-md border border-border bg-card shadow-xs";

/**
 * "Nothing here yet" box: a dashed outline, so it reads as a slot waiting to be
 * filled rather than as a card that failed to load.
 */
export const emptyStateClass =
  "flex flex-col items-center justify-center rounded-md border border-dashed border-border px-6 py-16 text-center";

/**
 * One shimmering placeholder block. Give it a width/height at the call site;
 * the pulse stops under reduced motion (styles.md §6.2).
 */
export const skeletonClass =
  "animate-pulse rounded-sm bg-secondary motion-reduce:animate-none";

/**
 * The small square that fronts a section heading or a list row. Size it at the
 * call site (`size-8`/`size-9`/`size-10`); everything else is fixed so the
 * tiles read as one family wherever they appear.
 */
export const iconTileClass =
  "flex shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground";

/**
 * Status chip: a pill on the secondary surface. The TONE is the caller's
 * (`text-success`, `text-destructive`, …) because that is the only thing an
 * order status, a payout status and a stock level should differ by.
 */
export const badgeClass =
  "rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium";

/** Dashboard page column: centred, capped, with the page gutters. */
export const pageShellClass = "mx-auto max-w-7xl px-6 py-8";

/** Page `<h1>`. */
export const pageTitleClass =
  "text-2xl font-semibold text-foreground md:text-3xl";

/** The one line under a page title, and under a section heading. */
export const pageSubtitleClass = "mt-1 font-inter text-sm text-muted-foreground";
