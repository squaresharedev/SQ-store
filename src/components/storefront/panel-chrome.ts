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
 *  same element renders as a plain block in its column.
 *
 *  HOW TALL IS A COMPROMISE, and it used to be settled entirely in the sheet's
 *  favour at 70vh. What that left of a phone's workspace — after the app
 *  header and the "open this on a desktop" banner — was a strip under 70px:
 *  enough for the tile the sheet was opened from, and not enough for the
 *  controls welded to its edges. The canvas duly anchored the selected tile
 *  flush to the sheet's top edge, and its resize and rotate handles, which
 *  hang under the tile and are the ONLY route to either gesture on a
 *  touchscreen, spent every edit buried under the sheet.
 *
 *  55vh leaves a strip that holds a tile and both bands of its chrome, and
 *  costs the sheet nothing it cannot recover by scrolling — which it already
 *  does. See selectionBoxes in useCanvasAnchor for the other half of that fix:
 *  the anchor now knows the chrome is there.
 *
 *  The bottom padding used to be `pb-24`, a 6rem gutter of nothing whose only
 *  job was to keep the sheet's last control out from under the floating editor
 *  toolbar. The toolbar now steps aside whenever a sheet is up (see
 *  activeMobileSheet below), so what is left to clear is the home indicator,
 *  and 2.5rem clears it.
 *
 *  Z-50, ABOVE EVERY OTHER SURFACE IN THE EDITOR. A sheet is the one thing on a
 *  phone that is meant to be read and pressed, so nothing on the board may be
 *  drawn over it — and the board IS drawn at a high level, deliberately: a
 *  selected tile's handles paint at 660 so they can be seen over every block
 *  (SELECTED_CHROME_Z in components/grid/gridConstants).
 *  On the DESIGN canvas that number is harmless, because the pan/zoom stage it
 *  lives on is its own stacking context and traps it. The MOBILE PREVIEW has no
 *  stage — it is a plain scrolling column — so the board's bands were compared
 *  against this class directly, and won: a selected tile painted straight over
 *  the sheet describing it. The workspace is `isolate`d now (see the <main> in
 *  StorefrontDesigner), which is the real fix and holds for any band the board
 *  ever grows; z-50 here is the second half of it, putting the sheet above the
 *  floating editor toolbar too (z-40) rather than level with it and settled by
 *  document order. Tooltips and select popovers portal into <body> at the same
 *  z-50 and so still land on top of the sheet they belong to, which is what a
 *  tip inside a sheet needs. */
export const SHEET_ON_MOBILE_CLASS =
  "fixed inset-x-0 bottom-0 z-50 max-h-[55vh] overflow-y-auto rounded-t-lg border-t border-border bg-background p-4 pb-10 shadow-lg lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:pb-0 lg:shadow-none";

/**
 * ROOM TO SCROLL A BLOCK OUT FROM UNDER A SHEET, in the mobile preview.
 *
 * The design canvas answers this with a pan: the board floats behind an endless
 * workspace, so there is always somewhere to move it to. The preview is a plain
 * scrolling column, and a column can only be scrolled as far as its content
 * goes — so a storefront short enough to fit the screen had NO scroll position
 * at all in which a block near its bottom cleared the sheet. Nothing was
 * covering it that could be moved; the board simply ended there.
 *
 * Reserving room under the content is what gives the column that position back
 * (see useScrollReveal, which then centres the selection in the strip).
 *
 * WHERE 78vh COMES FROM, since it is derived from the sheet above and not a
 * taste. Reserving the sheet's own 55vh is exactly enough to bring the last
 * block on the board level with the TOP of the strip — and no further, which
 * leaves the handles welded under that block hanging back over the sheet's
 * edge. Reaching the MIDDLE of the strip costs another half-strip: at most
 * `H/2 + 27.5vh` for a column of height H, which is 77.5vh at the limit of
 * H = 100vh and less for any real one, since the editor header takes its cut
 * first. So 78vh is the most any storefront can need, and a short board is the
 * only kind that needs any of it at all.
 *
 * Spent INSTEAD of the column's usual bottom padding rather than on top of it,
 * so the two can never be settled by stylesheet order.
 */
export const SHEET_SCROLL_ROOM_CLASS = "pb-[78vh]";

/** The panels that become bottom sheets below `lg`, in the order they win the
 *  one slot they share. */
export type MobileSheet =
  | "layers"
  | "settings"
  | "library"
  | "color"
  | "inspector";

/**
 * WHICH SHEET IS ON SCREEN: the single place the "one physical slot" rule is
 * decided.
 *
 * Below `lg` every panel in the designer is the same `fixed inset-x-0 bottom-0`
 * box, so two open panels are not two columns but one on top of the other. That
 * used to be settled ad hoc, by each sheet carrying its own `hidden` condition
 * naming whichever neighbour it had lost to, which is a rule with no single
 * place to read and one more clause to remember every time a panel is added.
 *
 * The order below is the whole rule, and it is an order of DELIBERATENESS. The
 * stack and the design settings are opened by pressing a control that means
 * exactly "show me this", so nothing outranks them. The library and the colour
 * picker are opened the same way and lose only to those. The inspector is last
 * because it is the one panel that opens on its own (selecting a block pops
 * it), and a panel that arrives uninvited has no business covering one that
 * was asked for.
 *
 * Two things beyond the sheets themselves hang off the answer: the floating
 * toolbar hides while any of them is up (it is drawn over the same strip), and
 * the canvas anchors the selection clear of whichever one it is.
 */
export function activeMobileSheet(open: {
  layers: boolean;
  settings: boolean;
  library: boolean;
  color: boolean;
  inspector: boolean;
}): MobileSheet | null {
  if (open.layers) return "layers";
  if (open.settings) return "settings";
  if (open.library) return "library";
  if (open.color) return "color";
  if (open.inspector) return "inspector";
  return null;
}

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
