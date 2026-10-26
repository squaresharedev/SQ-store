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

/** `cardClass` with square corners, like the buttons and the product posters:
 *  for a page built of cards that should read crisp (the product editor). */
export const sharpCardClass = "border border-border bg-card shadow-xs";

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
 * The thin bar across the top of the window while a page change is slow
 * (components/layout/NavigationProgress). Above every overlay and toast, and
 * click-through, so it never blocks the page it is waiting on.
 */
export const navProgressClass =
  "pointer-events-none fixed inset-x-0 top-0 z-[90] h-0.5 overflow-hidden";

/** The bar itself: it crawls toward the far edge and slows as it nears it
 *  (globals.css, "Navigation progress"); a still bar under reduced motion. */
export const navProgressBarClass = "nav-progress-bar h-full w-full origin-left bg-primary";

/**
 * The small square that fronts a section heading or a list row. Size it at the
 * call site (`size-8`/`size-9`/`size-10`); everything else is fixed so the
 * tiles read as one family wherever they appear.
 */
export const iconTileClass =
  "flex shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground";

/**
 * The track and fill of every thin bar that measures something: ProgressBar
 * (work under way) and Meter (a standing fact, like a limit half used). Width
 * is the caller's; the fill's is set inline from the value.
 */
export const meterTrackClass = "h-1 w-full overflow-hidden rounded-full bg-muted";
export const meterFillClass =
  "h-full rounded-full bg-primary transition-[width] duration-base ease-standard motion-reduce:transition-none";

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

/** Dashboard page column: centred, capped, with the page gutters. */
export const pageShellClass = "mx-auto max-w-7xl px-6 py-8";

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

/** A page's working column from the page's own left edge, like every list
 *  page: for settings with pictures beside them (the embed page). Capped so a
 *  field never runs the width of a wide screen. Inside `pageShellClass`. */
export const pageColumnClass = "w-full max-w-5xl";

/** A section's controls with their picture beside them: stacked on a phone,
 *  the picture in a fixed column on the right from `md` up. */
export const withPictureClass = "grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem] md:items-start";

/** The `<h2>` of a section inside a page. */
export const sectionTitleClass = "text-base font-semibold text-foreground";

/** The number of a step in a short how-to (the embed page): an ink disc, so
 *  the order, and that every step is part of the job, read at a glance. */
export const stepNumberClass =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground font-inter text-sm font-semibold text-background";

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

/** `codeSurfaceClass` with the ring in reds: the same slab and the same flow,
 *  for text the seller is required to use (the embed's privacy line), where
 *  green would say "optional, take it if you like". */
export const codeSurfaceDangerClass = `${codeSurfaceClass} code-surface-danger`;

/** A snippet's text inside it: wrapped, never scrolled sideways, so a phone
 *  shows all of it and there is no scroll region a keyboard cannot reach. */
export const codeTextClass = "whitespace-pre-wrap break-all font-mono text-xs leading-relaxed";

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

/**
 * The product grid: as many columns as fit at 14rem or wider, so a card is
 * 14 to about 18rem wide at every screen and never the 9rem the viewport
 * breakpoints give beside the sidebar on a small laptop.
 */
export const productGridClass = "grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]";

/**
 * A PRODUCT AS A POSTER: the photo fills the card and everything else sits on
 * it. The card is its own link target (a stretched link inside), so it lifts
 * on hover and draws the focus ring when that link has keyboard focus.
 * `isolate` plus the media layer at -z-10 keep the text in normal flow, which
 * is what lets the title's link span the whole card, photo included.
 *
 * NO `overflow-hidden` HERE: the card's menu opens over its own edge, and a
 * clip on the card would cut it off. Only the media layer clips (the photo's
 * hover zoom). While the menu is open the card is raised over its neighbours,
 * which would otherwise paint across the panel.
 */
export const posterCardClass =
  "group/card relative isolate flex aspect-[4/5] flex-col justify-end border border-border bg-card shadow-xs " +
  "transition-[transform,box-shadow] duration-base ease-standard " +
  "hover:-translate-y-0.5 hover:shadow-md has-[[data-card-link]:focus-visible]:-translate-y-0.5 " +
  "has-[[data-card-link]:focus-visible]:ring-2 has-[[data-card-link]:focus-visible]:ring-ring " +
  "has-[[data-card-link]:focus-visible]:ring-offset-2 has-[[data-card-link]:focus-visible]:ring-offset-background " +
  "has-[[role=dialog]]:z-20 motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** The poster's media layer: the photo and its scrim, clipped to the card so
 *  the photo can zoom without leaving it. Everything else on the card is free
 *  to overhang. */
export const posterMediaClass = "absolute inset-0 -z-10 overflow-hidden";

/** The photo in that layer, easing in a touch on card hover (still under reduced motion). */
export const posterPhotoClass =
  "size-full object-cover transition-transform duration-slow ease-standard " +
  "group-hover/card:scale-105 motion-reduce:transition-none motion-reduce:group-hover/card:scale-100";

/** Darkens the foot of a photo so white type on it reads on any picture. Fixed
 *  black like overlayScrimClass: its job is the same on either theme. */
export const posterScrimClass =
  "pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-linear-to-t from-black/85 via-black/60 via-45% to-transparent";

/** Ink on a scrimmed photo: white holds on any picture; the muted step is for
 *  the quieter lines under the name. */
export const onPhotoTextClass = "text-white";
export const onPhotoMutedTextClass = "text-white/75";

/** A chip laid over a product photo, lifted off the picture by its own
 *  surface and a shadow. The tone is the caller's. */
export const photoChipClass =
  "inline-flex max-w-full items-center gap-1 truncate rounded-sm px-1.5 py-0.5 font-inter text-xs font-medium shadow-sm";
