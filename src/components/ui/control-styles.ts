// Shared control class strings for the product UI (dashboard features import
// these, never per-feature copies). Every value is a token: radius from the
// styles.md scale (globals.css @theme), motion from duration-180 +
// ease-in-out (= styles.md --duration / --ease-standard), colors semantic.
//
// BRAND RULE: every button is SHARP (rounded-none). Only nav/menu items keep
// a radius. Defined once here (and consumed by the Button primitive), never
// set corner radius ad hoc in a component.

/** Shared motion + focus primitives, exported for one-off controls that
 *  can't wear a full button class (toolbars, tile chrome). */
export const transitionClass =
  "transition-colors duration-180 ease-in-out motion-reduce:transition-none";

export const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

/** Dangerous actions only (e.g. delete account). Outlined destructive token
 *  that fills on hover: unmistakable, still square like every other CTA. */
export const destructiveButtonClass = `${BUTTON_BASE} rounded-none border border-destructive bg-background text-destructive hover:bg-destructive hover:text-destructive-foreground`;

/** Square icon-only button (styles.md §8.4). */
export const iconButtonClass = `group/btn inline-flex size-9 items-center justify-center rounded-none border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground ${TRANSITION} ${FOCUS_RING}`;

/** Text input / select / textarea (styles.md §8.6). `aria-invalid` flips the
 *  border to the destructive token; an inline message is always shown too. */
export const fieldBaseClass = `w-full rounded-sm border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive ${TRANSITION} ${FOCUS_RING}`;

/** Form field label: Inter, small, medium weight (styles.md §5). */
export const labelClass = "font-inter text-sm font-medium text-foreground";

/** Muted helper text under a field. */
export const helpTextClass = "font-inter text-sm text-muted-foreground";

/** Inline validation message. */
export const errorTextClass = "font-inter text-sm text-destructive";

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
  "transition-transform duration-180 ease-out group-hover/btn:translate-x-0.5 group-focus-visible/btn:translate-x-0.5 motion-reduce:transition-none";

/** Nudge left: "back" navigation (a leading arrow). */
export const iconNudgeLeftClass =
  "transition-transform duration-180 ease-out group-hover/btn:-translate-x-0.5 group-focus-visible/btn:-translate-x-0.5 motion-reduce:transition-none";

/** Pop: "add / create / new" actions (a Plus). */
export const iconPopClass =
  "transition-transform duration-180 ease-out group-hover/btn:scale-110 group-focus-visible/btn:scale-110 motion-reduce:transition-none";
