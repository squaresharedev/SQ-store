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
 * The frame around an empty list that leads with an AddShowcase (products,
 * storefronts): a plain hairline card, no dashes and no texture, so the add
 * card's glow and the examples beside it are the only decoration on it.
 * `overflow-hidden` keeps the glow inside the frame.
 */
export const emptyShowcaseClass =
  "relative flex flex-col items-center justify-center overflow-hidden rounded-md border border-border bg-background px-6 py-16 text-center";

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

/** A narrow, centred reading column for single-purpose pages (a settings page
 *  for one thing). Sits inside `pageShellClass`, so the gutters still apply. */
export const pageColumnNarrowClass = "mx-auto w-full max-w-2xl";

/** Code the seller copies: a dark slab on either theme, so it reads as code and
 *  not as another form card. Pair with `cardHeaderClass`-style rows inside. */
export const codeSurfaceClass =
  "rounded-md border border-border bg-surface-dark text-surface-light";

/**
 * Something SquareShare staff asked the seller to change (a paused product's
 * section, one of its fields). The ink outline of the paused banner, so the
 * banner and every place it points at read as one signal. Monochrome on
 * purpose: a pause is a request, and red would read as a verdict.
 */
export const flaggedSurfaceClass = "border-foreground ring-1 ring-foreground";

/** One flagged FIELD inside a flagged section: an outline around the field's
 *  block, clear of the control's own focus ring and without moving layout. */
export const flaggedFieldClass =
  "rounded-sm outline outline-1 outline-offset-4 outline-foreground";

/** The name of one flagged part ("Photos"), in the banner and on its section:
 *  the same ink chip as the list card's "Paused" badge. */
export const flagChipClass =
  "inline-flex items-center gap-1 rounded-sm bg-foreground px-1.5 py-0.5 font-inter text-xs font-medium text-background";
