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
 * A greyed bar standing in for a line of content in a DRAWN page (the embed
 * hero, the buy button story). Give it a width at the call site.
 */
export const placeholderBarClass = "h-2 rounded-full bg-border";

/**
 * The round lock that sits over a picture of something not switched on yet (a
 * dimmed embed slot, a buy button with no page to land on). Centre it at the
 * call site.
 */
export const lockBadgeClass =
  "flex size-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs";

/**
 * Status chip: a pill on the secondary surface. The TONE is the caller's
 * (`text-success`, `text-destructive`, …) because that is the only thing an
 * order status, a payout status and a stock level should differ by.
 */
export const badgeClass =
  "rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium";

/**
 * An ink pill that marks the one thing in a set worth looking at first ("Best
 * value" on a plan, "Cheapest for you" in the calculator). Monochrome: the
 * ink is the emphasis, never a colour.
 */
export const inkBadgeClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground px-2 py-0.5 font-inter text-xs font-medium text-background";

/**
 * A saving, said in green ("Save 25%", "2 months free"): the one place a plan
 * surface spends colour, because money kept is the thing worth noticing and a
 * grey pill reads as a footnote. `text-success` is AA on its own tint.
 * On an ink surface (a selected segment) use `savingBadgeOnInkClass`.
 */
export const savingBadgeClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-inter text-xs font-semibold text-success";

/** `savingBadgeClass` for an ink background, where green-700 sinks into the
 *  surface: the lighter green the dark cards already use. */
export const savingBadgeOnInkClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-success-dark/20 px-2 py-0.5 font-inter text-xs font-semibold text-success-dark";

/**
 * The card a set leads with (the recommended plan): an ink outline and a
 * lifted shadow instead of a tint, so it stands out without a colour.
 */
export const featuredCardClass = "border-foreground ring-1 ring-foreground shadow-md";

/**
 * The small uppercase label over a group of content ("Everything in Free,
 * plus", a section's kicker). Quiet on purpose: the content is the loud thing.
 */
export const eyebrowClass = "font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * A strip across the top of every dashboard page for a standing condition the
 * seller must act on (seller details missing, a plan payment failing). The
 * tint alone separates it from the page: no rule underneath.
 */
export const bannerStripClass =
  "flex flex-wrap items-center gap-x-2 gap-y-1 bg-destructive/5 px-4 py-2 text-sm md:px-6";

/**
 * A count that is asking for work (orders waiting to ship): an ink pill, the
 * same ink as the "To ship" chip, so the number on the nav rail and on the
 * Orders tab read as the same thing. Pair it with a screen-reader sentence;
 * the digit alone says nothing about what it counts.
 */
export const attentionCountClass =
  "inline-flex min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 font-inter text-xs font-medium leading-5 tabular-nums text-background";

/** The page column on its own: centred, capped, with the page gutters. */
export const pageGutterClass = "mx-auto max-w-7xl px-6";

/**
 * The shell of a page that lets one band run edge to edge (the analytics
 * revenue hero): the page's top and bottom air and nothing at the sides.
 * Everything else on such a page wraps itself in `pageGutterClass`.
 */
export const pageBleedShellClass = "py-8";

/** Dashboard page column: centred, capped, with the page gutters. */
export const pageShellClass = `${pageGutterClass} ${pageBleedShellClass}`;

/** Page `<h1>`. */
export const pageTitleClass =
  "text-2xl font-semibold text-foreground md:text-3xl";

/** The `<h1>` of a card that IS the page: a sign-in step, an approval, one of
 *  their dead ends (components/auth). A step smaller than a page title, since
 *  the card around it is small. */
export const authHeadingClass = "text-xl font-semibold tracking-tight text-foreground";

/** The one line under a page title, and under a section heading. */
export const pageSubtitleClass = "mt-1 font-inter text-sm text-muted-foreground";

/** A narrow, centred reading column for single-purpose pages (a settings page
 *  for one thing). Sits inside `pageShellClass`, so the gutters still apply. */
export const pageColumnNarrowClass = "mx-auto w-full max-w-2xl";

/**
 * Code the seller copies (the embed snippet, the buy button's link, HTML and AI
 * prompt): a white slab inside a thick border of light green shades that flows slowly
 * around it, so it reads as something to take away and not as another form
 * card. The gradient stays inside the border. Still under reduced motion.
 *
 * The look is the `.code-surface` block in globals.css (it needs a
 * pseudo-element and a registered angle, which utilities cannot spell), tuned
 * there in one place; this only names it and keeps it SHARP, the brand's square
 * corners (the ring follows whatever radius the element has).
 * `p-1` keeps content clear of the ring by default (the ring is 4px); a call
 * site that sets its own padding replaces it. Lay out the inside yourself.
 */
export const codeSurfaceClass = "code-surface rounded-none p-1 text-foreground";

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
