// Class strings for the colour dots, shared by ColorPicker's inline row and the
// ColorPanel's grids (both render ColorDot), so a swatch's shape, ring and
// hover are decided in one place.

/** Hairline that gives white and pale tints a visible edge. */
const HAIRLINE = "ring-1 ring-inset ring-black/10";

/** The grow-and-shadow a swatch does under the pointer. */
const GROW = "hover:scale-110 hover:shadow-md motion-reduce:hover:scale-100";

/**
 * A dot in the ColorPanel's grids and palettes: it stretches to its column
 * (`w-full aspect-square`) and the chosen one wears a ring with a gap around it,
 * which sits OUTSIDE the dot so it cannot be mistaken for the hairline.
 */
export const COLOR_GRID_DOT = {
  cell: "flex aspect-square w-full items-center justify-center rounded-full",
  idle: HAIRLINE,
  active: "ring-2 ring-ring ring-offset-2 ring-offset-background",
  hover: GROW,
} as const;

/**
 * A dot in ColorPicker's inline row: a fixed 32px, so the row never reflows,
 * and the chosen one grows and lifts instead of taking a ring. The lift is the
 * small shadow token on purpose: the row scrolls, a scroller clips whatever
 * leaves its box, and a larger shadow showed up as a faint rectangle.
 */
export const COLOR_ROW_DOT = {
  cell: "flex size-8 shrink-0 items-center justify-center rounded-full",
  idle: HAIRLINE,
  active: "scale-115 shadow-sm ring-1 ring-inset ring-black/20",
  hover: GROW,
} as const;

/** The row itself: the wheel and eyedropper pinned at the start, then the
 *  swatches in a scroller. */
export const COLOR_ROW = "flex items-center gap-2";

/**
 * The scroller holding the swatches. It is one line however many colours there
 * are: more than fit scroll sideways, an edge with more beyond it fades
 * (`scroll-fade-x`), and the scrollbar is a faint capsule shown on hover
 * (`scrollbar-subtle`), both in globals.css. The side padding (and the vertical
 * padding, cancelled by the negative margin so the row keeps its height) leaves
 * room for the chosen swatch's growth, its shadow and the focus ring, all of
 * which a scroller would otherwise clip.
 */
export const COLOR_ROW_SCROLLER =
  "scroll-fade-x scrollbar-subtle relative flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1.5 py-3 -my-3";
