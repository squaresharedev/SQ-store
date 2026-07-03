// Shared control class strings for the product UI (dashboard features import
// these — never per-feature copies). Every value is a token: radius from the
// styles.md scale (globals.css @theme), motion from duration-180 +
// ease-in-out (= styles.md --duration / --ease-standard), colors semantic.
//
// BRAND RULE: primary CTAs are SHARP (rounded-none). Everything else uses the
// normal radius tokens. Defined once here (and consumed by the Button
// primitive) — never set CTA radius ad hoc in a component.

const TRANSITION =
  "transition-colors duration-180 ease-in-out motion-reduce:transition-none";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const BUTTON_BASE = `inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Primary action: solid black, SHARP corners (styles.md §8.3 + CTA rule). */
export const primaryButtonClass = `${BUTTON_BASE} rounded-none bg-primary text-primary-foreground hover:bg-primary/90`;

/** Secondary / neutral action: bordered surface (styles.md §8.4). */
export const secondaryButtonClass = `${BUTTON_BASE} rounded-sm border border-border bg-background text-foreground hover:bg-accent`;

/** Quiet text button. */
export const ghostButtonClass = `${BUTTON_BASE} rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground`;

/** Dangerous actions only (e.g. delete account). Outlined destructive token
 *  that fills on hover — unmistakable, still square like every other CTA. */
export const destructiveButtonClass = `${BUTTON_BASE} rounded-none border border-destructive bg-background text-destructive hover:bg-destructive hover:text-destructive-foreground`;

/** Square icon-only button (styles.md §8.4). */
export const iconButtonClass = `inline-flex size-9 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground ${TRANSITION} ${FOCUS_RING}`;

/** Text input / select / textarea (styles.md §8.6). `aria-invalid` flips the
 *  border to the destructive token; an inline message is always shown too. */
export const fieldBaseClass = `w-full rounded-sm border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive ${TRANSITION} ${FOCUS_RING}`;

/** Form field label: Inter, small, medium weight (styles.md §5). */
export const labelClass = "font-inter text-sm font-medium text-foreground";

/** Muted helper text under a field. */
export const helpTextClass = "font-inter text-sm text-muted-foreground";

/** Inline validation message. */
export const errorTextClass = "font-inter text-sm text-destructive";
