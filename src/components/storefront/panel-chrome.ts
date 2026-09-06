/**
 * Chrome shared by the designer's two docked panels.
 *
 * Held here rather than in either panel because both wear it: the left-hand
 * colour/library column and the right-hand design column are the same surface
 * with the border flipped, and a constant owned by one of them would have made
 * the other an importer of its neighbour.
 */

/** Mobile emergency-edit layout: a panel becomes a slide-up bottom sheet over
 *  the canvas (scrollable, padded to clear the floating toolbar); on lg+ the
 *  same element renders as a plain block in its column. */
export const SHEET_ON_MOBILE_CLASS =
  "fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-lg border-t border-border bg-background p-4 pb-24 shadow-lg lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:pb-0 lg:shadow-none";

/**
 * WHERE a collapse / reopen tab sits: pinned to the middle of the edge it
 * clings to, above the panel, and desktop-only (mobile uses bottom sheets).
 *
 * Split out from the chip below because the tab is wrapped in a <Tooltip>,
 * whose anchor is a real inline-flex span. Placement left on the button would
 * leave that span in the panel's normal flow as an empty line box, pushing
 * everything after it down by a line's height — so the box that is taken OUT
 * of the flow has to be the wrapper. The side (`fixed right-0` when the panel
 * is away, `absolute left-0 -translate-x-full` when it is docked) comes from
 * the call site, since the two tabs live on opposite edges.
 */
export const PANEL_TAB_ANCHOR_CLASS =
  "top-1/2 z-30 hidden -translate-y-1/2 lg:block";

/** The little tab that collapses / reopens a panel: a chip clipped to the
 *  panel's edge. Placed by PANEL_TAB_ANCHOR_CLASS above.
 *
 *  No shadow: the tab has no right border (it butts up against the panel), so
 *  a box-shadow spills out of that open edge and paints a seam down the join.
 *  The border on the other three sides is the whole affordance. */
export const PANEL_TAB_CLASS =
  "flex h-12 w-5 items-center justify-center rounded-l-md border border-r-0 border-border bg-background text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

/** Icon-only dismiss control in a panel header. */
export const INSPECTOR_CLOSE_CLASS =
  "inline-flex size-7 items-center justify-center rounded-none text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";
