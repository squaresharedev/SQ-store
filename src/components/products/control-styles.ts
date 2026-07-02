// Shared Tailwind class strings for the Products feature controls. Centralised
// so buttons, inputs, and the dropzones stay visually consistent and every
// value stays tokenised (styles.md §8). Radii are written as explicit rem
// values matching the styles.md scale, because the app's `--radius` token is
// currently 0 (square) and the product UI wants soft corners, exactly as the
// existing Sidebar does.

// Motion shared by every interactive control (styles.md §6.2), with the
// mandatory reduced-motion fallback.
const TRANSITION =
  "transition-colors duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none";

// Keyboard focus ring, matching the Sidebar family (styles.md §10).
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Primary action: solid black on white (styles.md §8.3). */
export const primaryButtonClass = `inline-flex items-center justify-center gap-2 rounded-[0.375rem] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Secondary / neutral action: bordered surface (styles.md §8.4). */
export const secondaryButtonClass = `inline-flex items-center justify-center gap-2 rounded-[0.375rem] border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Square icon-only button used for card quick actions (styles.md §8.4). */
export const iconButtonClass = `inline-flex size-9 items-center justify-center rounded-[0.375rem] border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground ${TRANSITION} ${FOCUS_RING}`;

/** Text input / select / textarea (styles.md §8.6). `aria-invalid` flips the
 *  border to the destructive token so error state reads without relying on
 *  colour alone (an inline message is always shown too). */
export const fieldBaseClass = `w-full rounded-[0.375rem] border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground disabled:opacity-50 aria-[invalid=true]:border-destructive ${TRANSITION} ${FOCUS_RING}`;

/** Form field label: Inter, small, medium weight (styles.md §5). */
export const labelClass = "font-inter text-sm font-medium text-foreground";

/** Muted helper text under a field. */
export const helpTextClass = "font-inter text-sm text-muted-foreground";

/** Inline validation message. */
export const errorTextClass = "font-inter text-sm text-destructive";
