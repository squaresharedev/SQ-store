// Shared control class strings for the product UI (dashboard features import
// these, never per-feature copies). Every value is a token: radius from the
// styles.md scale (globals.css @theme), motion from the motion scale
// (duration-fast/base/slow + ease-standard/ease-entrance), colors semantic.
//
// BRAND RULE: every button and every floating surface (modal, popover,
// dropdown, menu, toast) is SHARP (rounded-none). Only in-page nav items keep
// a radius. Defined once here (and consumed by the Button primitive and the
// overlay tokens below), never set corner radius ad hoc in a component.

/** Shared motion + focus primitives, exported for one-off controls that
 *  can't wear a full button class (toolbars, tile chrome). */
export const transitionClass =
  "transition-colors duration-base ease-standard motion-reduce:transition-none";

export const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Focus ring for a control sitting INSIDE an overlay: drawn inset, since an
 *  offset ring on a full-width menu row is clipped by the panel edge. */
export const focusRingInsetClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

const TRANSITION = transitionClass;
const FOCUS_RING = focusRingClass;

// `group/btn` marks every button as a named group so an icon child can react
// to the button's hover/focus (see the icon microinteractions below). Named,
// not bare `group`, so it never collides with the grid/tile `group` wrappers.
const BUTTON_BASE = `group/btn inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Primary action: solid black, SHARP corners (styles.md §8.3 + CTA rule). */
export const primaryButtonClass = `${BUTTON_BASE} rounded-none bg-primary text-primary-foreground hover:bg-primary/90`;

/** Secondary / neutral action: bordered surface (styles.md §8.4). Sharp
 *  corners like every other button, only nav/menu items stay rounded. */
export const secondaryButtonClass = `${BUTTON_BASE} rounded-none border border-border bg-background text-foreground hover:bg-accent`;

/** Quiet text button. */
export const ghostButtonClass = `${BUTTON_BASE} rounded-none text-muted-foreground hover:bg-accent hover:text-foreground`;

/** Quiet text button for a CONSEQUENTIAL action that isn't a full danger CTA
 *  (e.g. "Sign out everywhere"): reads as neutral at rest, turns destructive
 *  on hover/focus so the weight of it lands before the click. Same tinted
 *  treatment as the danger-zone nav item in SettingsShell. */
export const ghostDangerButtonClass = `${BUTTON_BASE} rounded-none text-muted-foreground hover:bg-destructive/5 hover:text-destructive focus-visible:text-destructive`;

/** Dangerous actions only (e.g. delete account). Outlined destructive token
 *  that fills on hover: unmistakable, still square like every other CTA. */
export const destructiveButtonClass = `${BUTTON_BASE} rounded-none border border-destructive bg-background text-destructive hover:bg-destructive hover:text-destructive-foreground`;

/** Square icon-only button (styles.md §8.4). */
export const iconButtonClass = `group/btn inline-flex size-9 items-center justify-center rounded-none border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground ${TRANSITION} ${FOCUS_RING}`;

/* --- Overlays: modal, popover, dropdown, listbox, menu, toast ----------
   Every floating surface is the SAME panel — sharp corners, hairline border,
   popover surface, lifted shadow — so a dropdown opened over a modal reads as
   one system. Spelled once here; a surface that needs a variation (a tone
   border on a toast, a tighter row in a listbox) composes with `cn`, which
   de-duplicates the conflicting utility for it. */

/** Dimmed wash behind a modal or a mobile sheet. Deliberately a fixed black
 *  rather than a theme token: a scrim's job is to darken whatever is behind
 *  it, which is the same requirement on a light or a dark page. */
export const overlayScrimClass = "fixed inset-0 bg-black/40";

/** The floating panel itself. Padding is the caller's, since a form modal and
 *  a one-line menu want different room. */
export const overlaySurfaceClass =
  "rounded-none border border-border bg-popover text-popover-foreground shadow-lg";

/** One selectable row inside an overlay: menu item, listbox option, action.
 *  `min-h-11` is the thumb target — px-3 py-2 alone leaves it at about 36px. */
export const overlayItemClass = `flex w-full min-h-11 items-center gap-2.5 rounded-none px-3 py-2 text-left text-sm text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${focusRingInsetClass}`;

/** Icon-only dismiss control on an overlay (a modal header, a sheet). */
export const overlayCloseButtonClass = `flex size-9 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:bg-accent hover:text-foreground ${TRANSITION} ${focusRingInsetClass}`;

/* --- Toolbar tip: a compact label above an icon-only control ------------
   Pure CSS, no portal — every caller today lives in a bar pinned to the
   viewport bottom, so "pops upward, centred" is the only placement any of
   them need. The trigger carries `group/tip relative` (baked into INSERT_BTN
   / ICON_BTN / MENU_ROW_BTN below); this is the label rendered as its last
   child. Named `/tip` rather than reusing `/btn` so it stays independent of
   the icon-pop microinteraction sharing the same trigger. */
export const toolbarTipClass =
  `${overlaySurfaceClass} pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap px-2 py-1 text-xs font-medium ` +
  `opacity-0 invisible transition-opacity duration-base ease-standard motion-reduce:transition-none ` +
  `group-hover/tip:visible group-hover/tip:opacity-100 group-focus-visible/tip:visible group-focus-visible/tip:opacity-100`;

/* --- Info tip: the one "?" in the product -------------------------------
   Explanatory prose that only some people need is not a paragraph under the
   control; it is a "?" beside its label that reveals the sentence on hover,
   on keyboard focus, and on tap. Spelled once here and worn by the single
   InfoTip component (components/ui/InfoTip.tsx) — never re-roll a second
   question mark somewhere else. */

/** The "?" affordance itself. Square like every other button (the circle is
 *  the glyph, not the box), 24px so it clears the WCAG target minimum while
 *  still riding alongside a label rather than competing with it. */
export const infoTipTriggerClass = `inline-flex size-6 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:text-foreground ${TRANSITION} ${FOCUS_RING}`;

/** The bubble it reveals: the same floating panel as every other overlay,
 *  capped to one column of readable text. Positioned `fixed` and placed from
 *  JS, so it is never clipped by a scrolling side panel or a table cell. */
export const infoTipBubbleClass = `${overlaySurfaceClass} fixed z-50 w-64 max-w-[calc(100vw-1rem)] px-3 py-2 font-inter text-sm leading-snug`;

/* --- Numeric stepper: [−][ 12 ][+] -------------------------------------
   The three parts are one control, so they share a height and sit flush. The
   buttons are SOLID (primary), not bordered: a bordered −/+ either side of a
   bordered field reads as three separate boxes, and the affordance is an
   action, not a container. `focus-visible:z-10` lifts whichever part is
   focused so its ring is not clipped by the neighbour sitting on top of it. */

/** The −/+ controls. Square, exactly as tall as the field between them. */
export const stepperButtonClass = `group/btn inline-flex size-9 shrink-0 items-center justify-center rounded-none bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 focus-visible:z-10 ${TRANSITION} ${FOCUS_RING}`;

/** The number between them. Fixed narrow width (a stock count is a handful of
 *  digits, not prose) and h-9 to match the buttons exactly. `text-base` is
 *  deliberate: anything smaller makes iOS zoom the page on focus. */
export const stepperFieldClass = `h-9 w-20 shrink-0 rounded-none border-y border-input bg-background px-2 text-center text-base text-foreground tabular-nums placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive focus-visible:z-10 ${TRANSITION} ${FOCUS_RING}`;

/** Text input / select / textarea (styles.md §8.6). `aria-invalid` flips the
 *  border to the destructive token; an inline message is always shown too. */
export const fieldBaseClass = `w-full rounded-sm border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive ${TRANSITION} ${FOCUS_RING}`;

/** The exact-value number field beside a slider (SliderField, FontSizeField).
 *  Narrow — three or four digits, never prose — so defined on its own rather
 *  than composed onto fieldBaseClass: that class's `w-full` can't be beaten by
 *  appending `w-12` as plain text (no twMerge in play here to drop the
 *  conflict), so the field would silently stay full width. The native
 *  up/down spinner is hidden too: the slider (and the track's own arrow-key
 *  support) already steps the value, so a second, tinier stepper glued to the
 *  field only ate the width back. */
export const sliderNumberFieldClass = `w-12 shrink-0 rounded-sm border border-input bg-background px-1 py-2.5 text-center text-sm text-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${TRANSITION} ${FOCUS_RING}`;

/** Form field label: Inter, small, medium weight (styles.md §5). */
export const labelClass = "font-inter text-sm font-medium text-foreground";

/** Editor-panel control label: semibold so the setting names carry the visual
 *  hierarchy in dense panels (the storefront designer's sections). */
export const strongLabelClass = "font-inter text-sm font-semibold text-foreground";

/** Muted helper text under a field. */
export const helpTextClass = "font-inter text-sm text-muted-foreground";

/** De-emphasized hint line in dense editor panels: SMALLER than helpTextClass,
 *  so labels and controls stay the loudest thing on screen.
 *
 *  The size does the de-emphasis on its own. It used to also fade the colour
 *  (`/80`), which put 12px text at 3.2:1 — below WCAG AA, and on the one line
 *  that explains what a control does. Muted text is already the dimmest step
 *  the palette has; anything past it is unreadable rather than quiet. */
export const infoTextClass = "font-inter text-xs text-muted-foreground";

/** Inline validation message. */
export const errorTextClass = "font-inter text-sm text-destructive";

/** "Last used" chip marking the sign-in option this browser used last.
 *
 *  Sentence case, not uppercase: this is a quiet aside to a returning user, and
 *  caps + letterspacing gave a two-word hint the weight of a section label.
 *  Sized below the chip scale (11px) so it rides alongside a control without
 *  competing with it, with the padding pulled in to match.
 *
 *  `text-foreground` rather than muted keeps it legible at that size, and it is
 *  deliberately NOT the acid accent: purple on the card surface lands around
 *  3.5:1 here, under AA, and position already does the work colour would. */
export const lastUsedBadgeClass =
  "inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-px font-inter text-[0.6875rem] font-medium leading-tight text-foreground";

/** "Soon" chip for stubbed, not-yet-wired controls. */
export const stubBadgeClass =
  "ml-2 inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-0.5 font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground";

// ── Icon microinteractions ──────────────────────────────────────────────
// Put on a lucide icon inside a button/link that carries `group/btn` (every
// shared button already does; a plain <Link> opts in by adding `group/btn`).
// Transform-only, so they layer over the button's own colour transition; each
// fires on hover AND keyboard focus, with a motion-reduce fallback to an
// instant state (styles.md §6.2). Deliberately tiny — feedback, not decoration.

/** Nudge right: "go / open / next / sign out" actions (a trailing arrow). */
export const iconNudgeRightClass =
  "transition-transform duration-base ease-entrance group-hover/btn:translate-x-0.5 group-focus-visible/btn:translate-x-0.5 motion-reduce:transition-none";

/** Nudge left: "back" navigation (a leading arrow). */
export const iconNudgeLeftClass =
  "transition-transform duration-base ease-entrance group-hover/btn:-translate-x-0.5 group-focus-visible/btn:-translate-x-0.5 motion-reduce:transition-none";

/** Pop: "add / create / new" actions (a Plus). */
export const iconPopClass =
  "transition-transform duration-base ease-entrance group-hover/btn:scale-110 group-focus-visible/btn:scale-110 motion-reduce:transition-none";

/**
 * Hover lift for a CARD: rises a hair and picks up the next shadow step, so a
 * grid of tiles reads as a set of targets rather than a static mosaic.
 *
 * Fires on three signals so the card responds however it is reached:
 * pointer hover, keyboard focus on the card itself (when it is the control),
 * and keyboard focus on a control INSIDE it (`has-[:focus-visible]`, e.g. a
 * card whose edit/delete buttons are the real targets). `focus-within` is
 * deliberately not used — it also fires for mouse clicks, which would leave a
 * card stuck in the lifted state after a click.
 *
 * `--shadow-sm` -> `--shadow-md` is the styles.md §6.1 step: cards lead with a
 * border and borrow a shadow only while active. Transform + shadow only, so
 * nothing reflows and neighbours never shift. Under reduced motion the shadow
 * still changes (the affordance survives) but the movement does not.
 *
 * Not for table rows: `<tr>` doesn't paint box-shadow reliably, so rows use a
 * background change instead.
 */
export const hoverLiftClass =
  "transition-[transform,box-shadow] duration-base ease-standard " +
  "hover:-translate-y-0.5 hover:shadow-md " +
  "focus-visible:-translate-y-0.5 focus-visible:shadow-md " +
  "has-[:focus-visible]:-translate-y-0.5 has-[:focus-visible]:shadow-md " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0 " +
  "motion-reduce:focus-visible:translate-y-0 motion-reduce:has-[:focus-visible]:translate-y-0";
