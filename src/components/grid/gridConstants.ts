import type { CSSProperties, ReactNode } from "react";
import {
  boardLanding,
  isOnBoard,
  orientedSpan,
  rotatedFootprint,
} from "@/lib/geometry/rotated-box";
import {
  rotatePoint,
  rotateVector,
  toLocalPoint,
  type Point,
} from "./rotationMath";

// Shared, presentation-agnostic constants + placement math for the canvas
// grid. Reused by BOTH the storefront builder and (later) the marketplace.
// Nothing here references product- or artifact-specific fields: the grid only
// ever knows a stable key, a placement, and an opaque `data` payload.
//
// PLACEMENT MODEL: every block states where it sits (x, y) and how many cells
// it covers (w, h) on a fixed columns x rows board. There is no auto-flow, so
// the gaps between blocks are deliberate.
//
// Blocks stay ON the board. Whether they may share cells is the CONSUMER's
// call (see `allowOverlap` on Grid): a design canvas stacks things on purpose,
// a packed listing grid must not. The helpers below answer both questions and
// are the single source of truth for whichever one a consumer asks.
//
// A block may also carry a `rotation`, and a turned block paints outside the
// cells it is placed in. Its FOOTPRINT (see blockFootprint) is what covers the
// board; x/y/w/h stay the unrotated rect, so turning a block never resizes it.

export interface GridPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A single grid item. `data` is an opaque consumer payload — the grid never
 * inspects it, which is what keeps the primitive reusable across the builder
 * (blocks) and the marketplace (artifacts).
 */
export interface GridBlock<TData = unknown> extends GridPlacement {
  /** Stable identity: doubles as the drag id and the React key. */
  key: string;
  data: TData;
  /**
   * Clockwise tilt in degrees. VISUAL ONLY: the block still occupies exactly
   * the cells x/y/w/h name, so overlap and packing are unaffected.
   *
   * Deliberately on the block rather than on GridPlacement, which is the
   * payload move and resize hand back. A resize describes cells, and letting
   * an absent rotation ride along in that payload is how a consumer spreading
   * it over a block would silently straighten a tile it never touched.
   */
  rotation?: number;
  /**
   * Paint depth, 0 = furthest back, rendered through {@link layerZIndex}.
   * VISUAL ONLY, and independent of DOM order: a consumer keeps handing blocks
   * in whatever order its own reading order says, and states depth here.
   *
   * Absent = paint in DOM order, which is what every board did before there
   * was anything to stack. Sharing GridBlock with `rotation` rather than
   * GridPlacement for the same reason: move and resize hand a placement back,
   * and depth must not ride along in that payload.
   */
  z?: number;
  /**
   * Half-cell insets (see HALF-CELL INSETS below): the block is drawn pulled
   * in by half a cell on these sides, inside the cells it occupies. Absent =
   * drawn on its whole cells, as every block was before.
   */
  inset?: GridInset;
  /**
   * Gestures move and stretch this block in HALF cells along any axis it is
   * small on (HALF_STEP_SPAN_MAX), and hand the result back through the
   * grid's `onPlace` as whole cells plus insets. Only honoured on a level
   * block, on a board drawn as placed, with an `onPlace` to call.
   */
  halfSteps?: boolean;
}

// PAINT ORDER BANDS. In ONE place because everything below shares a single
// stacking context: grid cells are siblings, so their z-indexes are compared
// against each other in the nearest stacking-context ancestor (the designer's
// stage, which makes one with its pan/zoom `transform`). A cell's own CONTENTS
// are already isolated by `contain: layout` on `.ss-grid > *` (globals.css),
// so a tile's chip, badges and framer need none of this.
//
// Content sits at the bottom of the range and is clamped to the ceiling, so a
// board can never stack a block over the editor's own affordances however many
// blocks it holds.

/**
 * The free-cell guides, UNDER every block.
 *
 * They are drawn after the blocks so that they come after them in the tab
 * order, and a grid item left at `z-index: auto` paints in document order — so
 * without a level of their own the guides paint over every tile, and over any
 * chrome a tile hangs outside its own edges.
 */
export const EMPTY_CELL_Z = 0;
/** Where a block's depth starts — above EMPTY_CELL_Z, always. */
export const LAYER_Z_BASE = 1;
/** Nothing content-driven paints above this, whatever a board's block count. */
export const LAYER_Z_CEILING = 500;
/** A tile lifted off the board by a drag or a resize. */
export const GESTURE_Z = 600;
/** A tile whose image is being framed, spilling past its own cell. */
export const FRAME_Z = 600;
/**
 * A tile's CHROME: its resize and rotate handles, drawn in a layer of their
 * own (`li[data-grid-chrome]`, the sibling right after the cell) so that they
 * paint above every block on the board, always.
 *
 * Above the content ceiling, so no stack of blocks can bury them, and above
 * GESTURE_Z and FRAME_Z, so neither a block dragged across them nor a picture
 * being framed beside them can either. Under OVERLAY_Z, which is the editor's
 * own drawing over the whole board.
 *
 * The CELL never rises for its handles. It used to (a handle inside a cell
 * cannot out-paint the cell's neighbours, since every cell is its own stacking
 * context), and that lift carried the block's content out of its layer, so it
 * had to be withheld from any block with something in front of it, which left
 * exactly those handles buried. A separate layer needs no such exception.
 *
 * MIRRORED IN globals.css (the `.ss-grid > [data-grid-chrome]` rules), which is
 * where it has to be applied: whether the handles show follows hover, focus
 * and selection, which are CSS states of the cell that this component cannot
 * know without re-rendering the board on every pointer crossing. Change both.
 */
export const CHROME_Z = 650;
/**
 * A SELECTED tile's chrome, above a merely hovered tile's.
 *
 * Two blocks stacked on the same cells hang their handles in the same place,
 * and at a tie document order hands the press to whichever comes later. The
 * block being worked on is the one that has to take it.
 *
 * MIRRORED IN globals.css alongside CHROME_Z. Change both.
 */
export const SELECTED_CHROME_Z = 660;
/** Editor overlays drawn over the whole board: the marquee band, snap guides. */
export const OVERLAY_Z = 700;

/** A block's depth as a real z-index, clamped into the content band. */
export function layerZIndex(z: number): number {
  return Math.min(LAYER_Z_CEILING, LAYER_Z_BASE + Math.max(0, z));
}

/** Default board size when a consumer does not state one. */
export const GRID_COLUMNS_DEFAULT = 6;
export const GRID_ROWS_DEFAULT = 6;

/**
 * Narrowest a cell may render before the grid stops honouring coordinates and
 * reflows into fewer columns (see `columnsThatFit`). Below roughly this size a
 * product tile stops being legible.
 */
export const MIN_CELL_PX = 72;

/** Fewest columns a reflow will drop to: below two it stops being a grid. */
export const MIN_REFLOW_COLUMNS = 2;

export function placementsOverlap(a: GridPlacement, b: GridPlacement): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/**
 * Is this placement wholly inside a columns x rows board?
 *
 * The STORED rect, deliberately, not the cells a turned block paints on. A
 * turned block keeps its span (see blockFootprint), so its painted box can
 * reach past an edge its rect sits against, and that overhang is not worth
 * moving a block the seller only asked to turn.
 */
export function withinCanvas(
  placement: GridPlacement,
  columns: number,
  rows: number,
): boolean {
  return (
    placement.x >= 0 &&
    placement.y >= 0 &&
    placement.x + placement.w <= columns &&
    placement.y + placement.h <= rows
  );
}

/** Slide a placement back inside the board, keeping its span. */
export function clampToCanvas(
  placement: GridPlacement,
  columns: number,
  rows: number,
): GridPlacement {
  const w = Math.min(placement.w, columns);
  const h = Math.min(placement.h, rows);
  return {
    w,
    h,
    x: Math.min(Math.max(0, placement.x), columns - w),
    y: Math.min(Math.max(0, placement.y), rows - h),
  };
}

/** The cells a grid block covers, tilt included. The same geometry the
 *  storefront contract's own `blockFootprint` reads, over the grid's block
 *  type instead of the config's. */
export function blockFootprint(block: GridBlock<unknown>): GridPlacement {
  return rotatedFootprint(block, block.rotation ?? 0);
}

/**
 * Can `candidate` go here — on the board, and clear of every other block?
 *
 * Tilt counts on BOTH sides of the question. Every other block is measured by
 * its footprint, so a tilted neighbour is considered where it paints rather
 * than where it is placed. And the candidate, turned by `rotation`, is measured
 * by its own footprint too, held to the board by the same per-axis rule a
 * saved block is (see isOnBoard): a turned bar is refused only where it really
 * does not fit, never merely because its stored rect reaches past an edge.
 * `rotation` defaults to level, which is every block nobody turned.
 *
 * On a board that allows stacking this is not a rule any more, only the
 * question "is this spot empty" that an auto-placer asks before it falls back
 * to putting the new block on top of something.
 */
export function placementIsFree(
  blocks: readonly GridBlock<unknown>[],
  candidate: GridPlacement,
  ignoreKey: string | null,
  columns: number,
  rows: number,
  rotation = 0,
): boolean {
  if (!isOnBoard(candidate, rotation, columns, rows)) return false;
  const covered = rotatedFootprint(candidate, rotation);
  return !blocks.some(
    (block) =>
      block.key !== ignoreKey &&
      placementsOverlap(blockFootprint(block), covered),
  );
}

/**
 * First free spot for a w x h block, scanning row by row. Null when full.
 *
 * `rotation` is the tilt the block will land with (a paste keeps its source's),
 * so the scan walks every position where that block is on the board — a
 * turned bar can land in the top row — and asks about the cells it will cover.
 */
export function findFreeCell(
  blocks: readonly GridBlock<unknown>[],
  w: number,
  h: number,
  columns: number,
  rows: number,
  rotation = 0,
): { x: number; y: number } | null {
  const landing = boardLanding({ x: 0, y: 0, w, h }, rotation, columns, rows);
  for (let y = landing.y.min; y <= landing.y.max; y += 1) {
    for (let x = landing.x.min; x <= landing.x.max; x += 1) {
      if (placementIsFree(blocks, { x, y, w, h }, null, columns, rows, rotation)) {
        return { x, y };
      }
    }
  }
  return null;
}

/**
 * First-fit packing: walk the items in order and drop each into the earliest
 * spot it fits, never searching backwards past the cursor. This is the same
 * placement CSS sparse row auto-flow performs, which is what makes it both the
 * migration path off auto-flow AND the small-screen reflow.
 */
export function packFirstFit(
  items: readonly { w: number; h: number }[],
  columns: number,
): { x: number; y: number; rows: number }[] {
  const occupied = new Set<string>();
  const free = (x: number, y: number, w: number, h: number) => {
    for (let row = y; row < y + h; row += 1) {
      for (let col = x; col < x + w; col += 1) {
        if (occupied.has(`${col},${row}`)) return false;
      }
    }
    return true;
  };

  let cursorRow = 0;
  let cursorCol = 0;
  let usedRows = 0;

  return items.map((item) => {
    const w = Math.min(Math.max(1, item.w), columns);
    const h = Math.max(1, item.h);
    let row = cursorRow;
    let col = cursorCol;
    for (;;) {
      if (col + w > columns) {
        row += 1;
        col = 0;
        continue;
      }
      if (free(col, row, w, h)) break;
      col += 1;
    }
    for (let r = row; r < row + h; r += 1) {
      for (let c = col; c < col + w; c += 1) occupied.add(`${c},${r}`);
    }
    usedRows = Math.max(usedRows, row + h);
    cursorRow = row;
    cursorCol = col + w;
    if (cursorCol >= columns) {
      cursorRow = row + 1;
      cursorCol = 0;
    }
    return { x: col, y: row, rows: usedRows };
  });
}

/**
 * How many columns fit at a readable cell size. Drives the responsive tiers:
 * equal to the design columns = render the layout as placed; fewer = reflow.
 */
export function columnsThatFit(
  width: number,
  gap: number,
  designColumns: number,
): number {
  if (width <= 0) return designColumns;
  const fits = Math.floor((width + gap) / (MIN_CELL_PX + gap));
  return Math.max(MIN_REFLOW_COLUMNS, Math.min(designColumns, fits));
}

/**
 * Small-screen fallback: coordinates are abandoned, blocks are taken in
 * reading order (top to bottom, then left to right), their spans scale by the
 * column ratio so relative size survives, and they repack. A 12-column board
 * with deliberate holes becomes a tight 3-column stack in the order the eye
 * would have crossed it.
 *
 * Scaled and packed by FOOTPRINT, not the stored rect — the same reason
 * `tidyBlocks` (StorefrontDesigner) packs by footprint rather than by the
 * rect a tilted block would otherwise claim too little (or too much) room
 * for: a block turned a quarter turn stands on its side, and reserving space
 * for its own w/h packs its NEIGHBOUR too close, since that neighbour is
 * placed against the cells the tile actually paints on, not the cells its
 * stored rect names. Rotation itself survives the reflow untouched — only
 * the packed rect changes — so a tilted tile is still tilted on a phone.
 *
 * The STORED rect is then CENTRED in the room its footprint was packed
 * into, again matching `tidyBlocks` — not simply placed at the packed
 * corner. blockFootprint centres a rotated rect on its own middle and floors
 * the result, so a block whose width and height differ in parity has a
 * footprint whose origin does not coincide with its stored rect's origin.
 * Handing the packed corner straight to the stored rect ignored that offset
 * and could leave the footprint sitting a cell away from the room actually
 * reserved for it — right on top of whatever was packed next.
 */
export function reflowBlocks<TData>(
  blocks: readonly GridBlock<TData>[],
  designColumns: number,
  renderColumns: number,
): { blocks: GridBlock<TData>[]; rows: number } {
  const ratio = renderColumns / designColumns;
  const ordered = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const scaled = ordered.map((block) => {
    const covered = blockFootprint(block);
    return {
      w: Math.min(renderColumns, Math.max(1, Math.round(covered.w * ratio))),
      h: Math.max(1, Math.round(covered.h * ratio)),
    };
  });

  const packed = packFirstFit(scaled, renderColumns);
  let rows = 0;
  const placed = ordered.map((block, index) => {
    rows = Math.max(rows, packed[index].rows);
    const room = scaled[index];
    const spot = packed[index];
    // Back to the STORED rect the footprint came from — the same relation
    // blockFootprint itself is built on (rotatedFootprint / orientedSpan),
    // run the other way round. The identity for a level block, since its
    // footprint already IS its stored rect.
    const stored = orientedSpan(room.w, room.h, block.rotation ?? 0);
    return {
      ...block,
      x: spot.x + Math.round((room.w - stored.w) / 2),
      y: spot.y + Math.round((room.h - stored.h) / 2),
      w: stored.w,
      h: stored.h,
    };
  });
  return { blocks: placed, rows };
}

/**
 * Whether a reflowed block still has somewhere to grow on the board it is
 * actually drawn on right now.
 *
 * A repacked board cannot honour a resize's stored coordinates in general
 * (see Grid's `interactive`), but that is an argument for translating the
 * result back through the same scale reflow used to shrink it, not for
 * refusing every tile on the board a corner handle. Only a block already
 * pressed against the FULL width and the FULL height of the repacked layout
 * has nowhere left to go — one of the two still open is room enough for the
 * handle to mean something.
 */
export function reflowHasRoom(
  block: { w: number; h: number },
  renderColumns: number,
  renderRows: number,
): boolean {
  return block.w < renderColumns || block.h < renderRows;
}

/**
 * Turns a corner-resize made on a REPACKED board back into the STORED
 * design's own column count.
 *
 * `origin`/`derived` are the block's box before and after the gesture, both
 * read off the repacked board the seller was actually dragging on; `real` is
 * that same block's STORED box, at the design's true column count. The
 * result is `real` shifted by the SAME delta the gesture made, run through
 * reflow's own scale (`ratio = renderColumns / designColumns`) and rounded —
 * "grew by one shown cell" becomes the right number of stored cells,
 * whichever corner moved and whatever this tile's real column count is.
 *
 * A delta survives the column count changing under it; an absolute
 * coordinate does not, which is the whole reason this exists instead of
 * simply writing `derived` back as `real`.
 */
export function invertReflowResize(
  origin: GridPlacement,
  derived: GridPlacement,
  real: GridPlacement,
  ratio: number,
  columns: number,
  rows: number,
): GridPlacement {
  const invert = (delta: number) => Math.round(delta / ratio);
  return clampToCanvas(
    {
      x: real.x + invert(derived.x - origin.x),
      y: real.y + invert(derived.y - origin.y),
      w: Math.max(1, real.w + invert(derived.w - origin.w)),
      h: Math.max(1, real.h + invert(derived.h - origin.h)),
    },
    columns,
    rows,
  );
}

// EDGE-GRAB RESIZE. A press near a cell's border resizes from that side
// (corners combine two sides); a press on the inner surface stays a move.
// The hit-test and the placement math live here, pure, so the gesture wiring
// in Grid.tsx stays thin and this part stays unit-testable.
//
// EVERYTHING BELOW WORKS IN THE BLOCK'S OWN FRAME. The pointer is un-rotated
// about the block's centre first (see toLocalPoint), so "the north edge" means
// the edge the seller can see along the top of the tilted tile, wherever that
// happens to point on screen. Then the corner OPPOSITE the one being dragged
// is pinned in SCREEN space, so the box grows out from under the hand and the
// far side stays where it was.
//
// Reading the drag in board space instead is what made a tilted tile resize
// along the wrong axis: at a quarter turn the tile's height is drawn across
// the screen, so pulling its corner up shortened it by making the stored rect
// narrower, and every angle in between had no honest answer at all.

/** Which sides of a block a gesture is dragging. */
export interface ResizeEdges {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/** How close (screen px) to a cell border a press counts as an edge grab. */
export const EDGE_GRAB_PX = 10;

/**
 * The edges under a pointer, or null when the press is on the inner surface
 * (a move/select, not a resize). The grab zone is capped at a quarter of the
 * cell per axis, so a small or zoomed-out tile always keeps an inner area to
 * drag from instead of becoming all edge.
 *
 * `rect` is the block's OWN unrotated box and the point is the pointer
 * un-rotated into that same frame, so the comparison stays a plain box test
 * however far the tile has been turned.
 */
export function edgesUnderPointer(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
  grab: number = EDGE_GRAB_PX,
): ResizeEdges | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const grabX = Math.min(grab, rect.width / 4);
  const grabY = Math.min(grab, rect.height / 4);
  const edges = {
    n: y - rect.top <= grabY,
    s: rect.top + rect.height - y <= grabY,
    w: x - rect.left <= grabX,
    e: rect.left + rect.width - x <= grabX,
  };
  return edges.n || edges.e || edges.s || edges.w ? edges : null;
}

/**
 * Shift+Arrow's resize step, for a block that may be turned.
 *
 * `delta` is the arrow's SCREEN-space direction (Right is [1, 0], Down is
 * [0, 1]). Un-rotating it into the block's own frame — the same question the
 * resize handle answers by un-rotating the pointer — says which STORED axis
 * (w or h) that screen direction actually grows. Without this, Right always
 * added to `w` and Down always added to `h` regardless of tilt: right on
 * screen for a level block IS the block's own width axis, but at 90 degrees
 * screen-right is the block's own HEIGHT axis instead, so pressing Down on a
 * turned block grew it sideways rather than the way it looked like it should.
 *
 * The anchor stays the block's own top-left corner either way — x and y are
 * untouched — matching the level case: an arrow only ever moves the far
 * edge, never the near one. Corner and edge dragging are where the other
 * anchors live.
 */
export function keyboardResizeStep(
  block: GridBlock<unknown>,
  delta: readonly [number, number],
): GridPlacement {
  const angle = block.rotation ?? 0;
  const local = rotateVector({ x: delta[0], y: delta[1] }, -angle);
  const alongWidth = Math.abs(local.x) >= Math.abs(local.y);
  return {
    x: block.x,
    y: block.y,
    w: Math.max(1, block.w + (alongWidth ? Math.sign(local.x) : 0)),
    h: Math.max(1, block.h + (alongWidth ? 0 : Math.sign(local.y))),
  };
}

function clampSpan(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * A box in the block's OWN unrotated frame, stated as grid LINES rather than
 * cell indices: it spans [l, r] across and [t, b] down. Lines, because a
 * resize names edges and an edge sits between two cells; indices would need an
 * off-by-one at every use and one of them would eventually be wrong.
 *
 * Continuous, so a live drag can describe a box a third of the way into a cell
 * and the same math can hand back the whole-cell one it will land on.
 */
export interface LocalBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * The board, mapped into a block's own frame: the axis-aligned box that
 * contains it.
 *
 * A resize has to stop at the board's edge, and the drag it is stopping is
 * expressed in the block's frame, so the limit has to be too. Landing on a
 * whole cell is exact for a quarter turn ONLY when the block's own centre
 * already sits on a grid line — which fails the moment its width or height is
 * odd (a 2x1 bar's centre is half a cell down). Turning the board's corners
 * about that off-grid centre then lands them on a half-cell line too, and
 * clamping a drag to a fractional bound is what used to hand
 * placementFromLocalBox a box that could not round onto the board cleanly, so
 * a resize past the edge on an odd-dimensioned tile at +/-90 could drift a
 * whole cell off the corner the hand was pinning. Rounding OUTWARD here — so
 * the bound still fully contains the true (possibly fractional) board rather
 * than cutting into it — is what keeps a clamped drag landing on a cell the
 * board actually has. For the angles in between this was already only a safe
 * outer bound, which is all a span cap needs — the placement itself is held
 * to the board separately, by clampToCanvas.
 */
export function boardInLocalFrame(
  origin: GridPlacement,
  degrees: number,
  columns: number,
  rows: number,
): LocalBox {
  const center = {
    x: origin.x + origin.w / 2,
    y: origin.y + origin.h / 2,
  };
  const corners = [
    { x: 0, y: 0 },
    { x: columns, y: 0 },
    { x: columns, y: rows },
    { x: 0, y: rows },
  ].map((corner) => toLocalPoint(center, degrees, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    l: Math.floor(Math.min(...xs)),
    r: Math.ceil(Math.max(...xs)),
    t: Math.floor(Math.min(...ys)),
    b: Math.ceil(Math.max(...ys)),
  };
}

/**
 * The box a resize drag lands on, worked out in the block's own frame.
 *
 * `local` is the pointer un-rotated about the block's centre and expressed in
 * CELLS, so this is plain one-dimensional arithmetic per axis: the dragged
 * edge goes where the hand is, the opposite one does not move, and the span
 * never collapses below a cell or reaches past `bounds` (the board, in this
 * same frame — see boardInLocalFrame).
 *
 * Two boxes come back for one drag. `live` follows the pointer exactly and is
 * what the tile paints, so the edge stays under the hand; `snapped` is the
 * whole-cell box it will commit to, and is what the ghost promises. Deriving
 * both here rather than snapping afterwards keeps them from ever disagreeing
 * about which side is pinned.
 *
 * `anchor` is the corner that must not move, in the same local frame. Which
 * corner that is depends on the gesture, which is why it is returned rather
 * than re-derived by the caller.
 */
export function resizeLocalBox(
  origin: GridPlacement,
  edges: ResizeEdges,
  local: Point,
  bounds: LocalBox,
  mode: "edge" | "corner" = "edge",
): { live: LocalBox; snapped: LocalBox; anchor: Point } {
  const l0 = origin.x;
  const r0 = origin.x + origin.w;
  const t0 = origin.y;
  const b0 = origin.y + origin.h;

  if (mode === "corner") {
    // The handle names a CELL to span to, not a line to put a border on: the
    // block reaches from its anchor cell to whichever cell the hand is over,
    // that cell included. It has to be cells here, because the handle sits
    // INSIDE the corner it drags — line rounding would leave the hand a
    // fraction of a cell short and a drag of exactly one cell would do nothing.
    //
    // Drag past the anchor cell and the span simply lands on the other side of
    // it, so a single control stretches every way. All in the tile's own
    // frame, so it follows the hand when the tile is turned too.
    const cellX = Math.floor(local.x);
    const cellY = Math.floor(local.y);
    const flippedX = cellX < l0;
    const flippedY = cellY < t0;
    // `local` is read at the CENTRE of whichever cell the hand is over (see
    // the caller's grab offset), so that the snap below stays put across the
    // whole cell rather than flipping the moment the hand crosses a line.
    // The live edge, though, has to track the true grid line: uncorrected, it
    // sits half a cell short of it the instant the drag starts (the centre of
    // the anchor's own far cell, not that cell's far edge), which is what
    // made a fresh grab paint the tile shrinking before the hand had moved at
    // all. Re-centring it here — the one continuous reading, used on both
    // sides of a flip so the two halves still meet without a seam — is what
    // makes a stationary hand paint no change.
    const liveX = local.x + 0.5;
    const liveY = local.y + 0.5;
    const build = (snap: boolean): LocalBox => ({
      l: flippedX
        ? clampSpan(snap ? cellX : liveX, bounds.l, l0)
        : l0,
      r: flippedX
        ? l0 + 1
        : clampSpan(snap ? cellX + 1 : liveX, l0 + 1, bounds.r),
      t: flippedY
        ? clampSpan(snap ? cellY : liveY, bounds.t, t0)
        : t0,
      b: flippedY
        ? t0 + 1
        : clampSpan(snap ? cellY + 1 : liveY, t0 + 1, bounds.b),
    });
    return {
      live: build(false),
      snapped: build(true),
      // Flipped, the anchor cell's FAR side is what stays still.
      anchor: { x: flippedX ? l0 + 1 : l0, y: flippedY ? t0 + 1 : t0 },
    };
  }

  // An edge drag names a LINE, not a cell: the hand is already on the border,
  // so the border goes to the nearest grid line it is pushed to.
  const build = (snap: boolean): LocalBox => {
    const px = snap ? Math.round(local.x) : local.x;
    const py = snap ? Math.round(local.y) : local.y;
    let l = l0;
    let r = r0;
    let t = t0;
    let b = b0;
    if (edges.w) l = clampSpan(px, bounds.l, r0 - 1);
    else if (edges.e) r = clampSpan(px, l0 + 1, bounds.r);
    if (edges.n) t = clampSpan(py, bounds.t, b0 - 1);
    else if (edges.s) b = clampSpan(py, t0 + 1, bounds.b);
    return { l, t, r, b };
  };
  return {
    live: build(false),
    snapped: build(true),
    anchor: { x: edges.w ? r0 : l0, y: edges.n ? b0 : t0 },
  };
}

/**
 * The placement a resized box needs so that its anchor corner has not moved on
 * screen. Continuous: the caller rounds it to whole cells to commit, and uses
 * it as it is to paint the live preview.
 *
 * A block is drawn turned about its own CENTRE, and changing its size moves
 * that centre — which is why a resize cannot just write the new width and
 * height and leave x/y alone. That is exactly what used to make the far side
 * of a tilted tile drift away while the near side was being dragged. So: find
 * where the pinned corner is on screen now, work out where the same corner of
 * the NEW box sits relative to its centre once turned, and place the box so
 * the two coincide.
 */
export function placementFromLocalBox(
  origin: GridPlacement,
  degrees: number,
  box: LocalBox,
  anchor: Point,
): { x: number; y: number; w: number; h: number } {
  const w = box.r - box.l;
  const h = box.b - box.t;
  const center = {
    x: origin.x + origin.w / 2,
    y: origin.y + origin.h / 2,
  };
  const pinned = rotatePoint(center, degrees, anchor);
  const fromCenter = rotateVector(
    { x: anchor.x - (box.l + w / 2), y: anchor.y - (box.t + h / 2) },
    degrees,
  );
  return {
    x: pinned.x - fromCenter.x - w / 2,
    y: pinned.y - fromCenter.y - h / 2,
    w,
    h,
  };
}

/**
 * The standard resize cursor for a set of grabbed edges, turned to face the
 * way the tile does.
 *
 * The edges are named in the BLOCK'S frame, so a tilted tile's north edge does
 * not point north on screen. The cursor arrow has to, or the hand is told the
 * wrong direction. Cursors come in four fixed directions, so the turned edge
 * normal is folded onto the nearest of them; a resize cursor is double-headed,
 * which is why the bearing folds to half a turn rather than a whole one.
 */
export function edgeCursor(edges: ResizeEdges, degrees = 0): string {
  const dx = (edges.e ? 1 : 0) - (edges.w ? 1 : 0);
  const dy = (edges.s ? 1 : 0) - (edges.n ? 1 : 0);
  if (dx === 0 && dy === 0) return "";
  const facing = rotateVector({ x: dx, y: dy }, degrees);
  const bearing =
    (((Math.atan2(facing.y, facing.x) * 180) / Math.PI + 180) % 180 + 180) % 180;
  if (bearing < 22.5 || bearing >= 157.5) return "ew-resize";
  if (bearing < 67.5) return "nwse-resize";
  if (bearing < 112.5) return "ns-resize";
  return "nesw-resize";
}

/** Per-render state the grid hands to `renderBlock`, for content-level styling. */
export interface GridBlockState {
  editable: boolean;
  isDragging: boolean;
  isResizing: boolean;
  /** Live placement during a drag/resize; the committed one when idle. */
  placement: GridPlacement;
  /**
   * The key of the underlay drawn behind this block as the board is laid out
   * right now (underlayBehind), or null for none. On a reflowed or narrow
   * board that can differ from the one behind its stored rows, which is why
   * the grid says: it is what the block's words are actually read against.
   */
  underlayKey: string | null;
}

/**
 * Consumer-supplied render function. Receives the block + transient state.
 * The grid provides only the cell shape (radius + overflow clip) and, in
 * editable mode, the drag/resize affordances — renderBlock paints its own
 * opaque surface, since the grid stays presentation-agnostic.
 */
export type RenderGridBlock<TData> = (
  block: GridBlock<TData>,
  state: GridBlockState,
) => ReactNode;

// HALF-CELL INSETS. A block may be drawn pulled in by half a cell on any of
// its four sides, so a small thing can sit between two cells or be half a cell
// across. The block still OCCUPIES the whole cells x/y/w/h name (overlap,
// packing, the reflow and every other rule read those), and only its paint
// and the gestures that write it know about the halves.
//
// Gestures on such a block work in HALF CELLS: a box is stated as half-cell
// LINES (l, t, r, b), moved and stretched there, and turned back into whole
// cells plus insets (fromHalves). Lines rather than cells for the same reason
// LocalBox uses them: an edge sits between two cells.

/** The sides a block is pulled in by half a cell. Absent or false = none. */
export interface GridInset {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

/** A box in half-cell lines: it spans [l, r] across and [t, b] down. */
export interface HalfBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * The longest a block may be along an axis, in cells, and still move along
 * it in half steps. Small things are what need placing between two cells;
 * anything longer moves in whole cells there, as everything always has.
 */
export const HALF_STEP_SPAN_MAX = 2;

/** Is anything pulled in at all? */
export function hasInset(inset: GridInset | undefined): inset is GridInset {
  return Boolean(inset && (inset.left || inset.right || inset.top || inset.bottom));
}

/**
 * The inset a block can actually draw at a given span: a side one cell long
 * cannot be pulled in from both ends (nothing would be left), so it keeps the
 * leading one. Only reached on a board that was not the one the insets were
 * set on (a phone's), since the schema refuses the stored case.
 */
export function drawnInset(inset: GridInset | undefined, w: number, h: number): GridInset | undefined {
  if (!hasInset(inset)) return undefined;
  const next: GridInset = {};
  if (inset.left) next.left = true;
  if (inset.right && !(w <= 1 && inset.left)) next.right = true;
  if (inset.top) next.top = true;
  if (inset.bottom && !(h <= 1 && inset.top)) next.bottom = true;
  return next;
}

/** A placement and its insets, as half-cell lines. */
export function toHalves(placement: GridPlacement, inset?: GridInset): HalfBox {
  return {
    l: 2 * placement.x + (inset?.left ? 1 : 0),
    t: 2 * placement.y + (inset?.top ? 1 : 0),
    r: 2 * (placement.x + placement.w) - (inset?.right ? 1 : 0),
    b: 2 * (placement.y + placement.h) - (inset?.bottom ? 1 : 0),
  };
}

const isOdd = (value: number) => ((value % 2) + 2) % 2 === 1;

/**
 * Half-cell lines back into the whole cells that hold them and the insets
 * that pull the paint in. The cells are the smallest run that contains the
 * box, so a block never claims a cell it does not reach into.
 */
export function fromHalves(box: HalfBox): { placement: GridPlacement; inset: GridInset | undefined } {
  const x = Math.floor(box.l / 2);
  const y = Math.floor(box.t / 2);
  const placement = {
    x,
    y,
    w: Math.max(1, Math.ceil(box.r / 2) - x),
    h: Math.max(1, Math.ceil(box.b / 2) - y),
  };
  const inset: GridInset = {};
  if (isOdd(box.l)) inset.left = true;
  if (isOdd(box.r)) inset.right = true;
  if (isOdd(box.t)) inset.top = true;
  if (isOdd(box.b)) inset.bottom = true;
  return { placement, inset: hasInset(inset) ? inset : undefined };
}

/** The box a block is DRAWN on, in cells (halves where it is inset). */
export function drawnPlacement(placement: GridPlacement, inset?: GridInset): GridPlacement {
  const box = toHalves(placement, drawnInset(inset, placement.w, placement.h));
  return { x: box.l / 2, y: box.t / 2, w: (box.r - box.l) / 2, h: (box.b - box.t) / 2 };
}

/** How many half cells one step is along each axis: one along an axis the
 *  block is small on, two (a whole cell) along any other. */
export function halfStepSizes(box: HalfBox): { x: 1 | 2; y: 1 | 2 } {
  return {
    x: box.r - box.l <= 2 * HALF_STEP_SPAN_MAX ? 1 : 2,
    y: box.b - box.t <= 2 * HALF_STEP_SPAN_MAX ? 1 : 2,
  };
}

/** A count of half cells rounded to a step of 1 or 2. */
export function roundToStep(halves: number, step: 1 | 2): number {
  return step === 1 ? Math.round(halves) : 2 * Math.round(halves / 2);
}

/** A box moved by (dx, dy) half cells, held to a columns x rows board as one
 *  body: it stops at an edge rather than squashing against it. */
export function moveHalfBox(box: HalfBox, dx: number, dy: number, columns: number, rows: number): HalfBox {
  const stepX = Math.min(Math.max(dx, -box.l), 2 * columns - box.r);
  const stepY = Math.min(Math.max(dy, -box.t), 2 * rows - box.b);
  return { l: box.l + stepX, r: box.r + stepX, t: box.t + stepY, b: box.b + stepY };
}

/**
 * A box with some of its edges put on new lines, held to the board and never
 * narrower or shorter than half a cell. `edges` names which lines move; the
 * others stay where they are.
 */
export function resizeHalfBox(
  box: HalfBox,
  edges: ResizeEdges,
  to: { x: number; y: number },
  columns: number,
  rows: number,
): HalfBox {
  const next = { ...box };
  if (edges.w) next.l = Math.min(Math.max(0, to.x), box.r - 1);
  else if (edges.e) next.r = Math.max(Math.min(2 * columns, to.x), box.l + 1);
  if (edges.n) next.t = Math.min(Math.max(0, to.y), box.b - 1);
  else if (edges.s) next.b = Math.max(Math.min(2 * rows, to.y), box.t + 1);
  return next;
}

/**
 * Where a block's cell is PAINTED, as offsets and a size in its own grid
 * area: the half-cell nudge a turned block needs (`shift`, in cells), plus its
 * insets. Stated against the grid area rather than measured, the way
 * snapToGridStyle in Grid is: `(100% + gap) / span` is one cell pitch however
 * wide the board is drawn, and a grid item's width and height percentages
 * resolve against its area.
 *
 * Nothing for a block with neither, so an unchanged block carries no new
 * style at all.
 */
export function cellPaintStyle(
  placement: GridPlacement,
  shift: { x: number; y: number },
  inset: GridInset | undefined,
): CSSProperties {
  const drawn = drawnInset(inset, placement.w, placement.h);
  const pitch = (cells: number, span: number) => `calc((100% + var(--grid-gap, 0px)) * ${cells} / ${span})`;
  const offsetX = shift.x + (drawn?.left ? 0.5 : 0);
  const offsetY = shift.y + (drawn?.top ? 0.5 : 0);
  const cutX = (drawn?.left ? 1 : 0) + (drawn?.right ? 1 : 0);
  const cutY = (drawn?.top ? 1 : 0) + (drawn?.bottom ? 1 : 0);
  return {
    ...(offsetX ? { left: pitch(offsetX, placement.w) } : {}),
    ...(offsetY ? { top: pitch(offsetY, placement.h) } : {}),
    ...(cutX ? { width: `calc(100% - ${pitch(cutX / 2, placement.w)})` } : {}),
    ...(cutY ? { height: `calc(100% - ${pitch(cutY / 2, placement.h)})` } : {}),
  };
}

// FULL-ROW UNDERLAYS. A strip a consumer draws behind a run of the board's
// rows, across every column (a storefront's full-width band). Not a block:
// nothing selects, packs or overlaps it, and it paints under every block.
//
// On a board drawn as placed it covers the rows it names. On a reflowed or
// narrow board, where the rows mean nothing any more, it FOLLOWS the blocks
// the consumer says sit on it: it runs from the first of them to the last, as
// they were laid out there. One with nothing on it has no place on such a
// board and is not drawn.

export interface GridUnderlay {
  key: string;
  /** The first row it sits behind, and how many it runs. */
  y: number;
  h: number;
  /** The keys of the blocks sitting on it, which it follows when the board is
   *  reflowed. */
  members?: readonly string[];
  /** What it paints. Drawn in a layer under every block. */
  node: ReactNode;
  /** Editor controls for it, drawn above every block (editable boards only,
   *  and only while the board is drawn as placed). */
  chrome?: ReactNode;
}

/**
 * The rows an underlay runs behind on a board laid out as `placed`.
 *
 * It starts from its LEAD member (the first of `members` on that board: the
 * consumer lists them in reading order) and takes in every other member whose
 * rows touch or overlap what it already covers, until none is left that does.
 * A member the layout put somewhere else entirely (a phone layout that filled
 * an earlier gap with it) is left off the strip rather than stretching it
 * over everything in between. Null when none of its members is on the board.
 */
export function followRows(
  members: readonly string[],
  placed: readonly GridBlock<unknown>[],
): { y: number; h: number } | null {
  const byKey = new Map(placed.map((block) => [block.key, block]));
  const rows = members.flatMap((key) => {
    const block = byKey.get(key);
    if (!block) return [];
    const covered = blockFootprint(block);
    return [{ top: covered.y, bottom: covered.y + covered.h }];
  });
  if (rows.length === 0) return null;
  let { top, bottom } = rows[0];
  const left = rows.slice(1);
  for (let grew = true; grew; ) {
    grew = false;
    for (let index = left.length - 1; index >= 0; index -= 1) {
      const next = left[index];
      if (next.top > bottom || next.bottom < top) continue;
      top = Math.min(top, next.top);
      bottom = Math.max(bottom, next.bottom);
      left.splice(index, 1);
      grew = true;
    }
  }
  const y = Math.max(0, top);
  return { y, h: Math.max(1, bottom - y) };
}

/**
 * The underlay drawn behind a placement as it is laid out: the one behind its
 * MIDDLE row (a block that only grazes a strip's edge is not on it), the later
 * one in the list where two overlap, since it paints on top. The board-side
 * twin of lib/storefront/backdrop's bandBehind, asked of what is drawn.
 */
export function underlayBehind(
  underlays: readonly { key: string; y: number; h: number }[],
  placement: GridPlacement,
): string | null {
  const middle = placement.y + placement.h / 2;
  for (let index = underlays.length - 1; index >= 0; index -= 1) {
    const underlay = underlays[index];
    if (middle >= underlay.y && middle <= underlay.y + underlay.h) return underlay.key;
  }
  return null;
}

// Token class references (styles.md). Kept here so no component hardcodes the
// radius; the gap + square-cell mechanics live in the `.ss-grid` rule in
// globals.css (driven by the --grid-gap token + injected column/row counts).
export const GRID_CELL_RADIUS_CLASS = "rounded-sm"; // --radius-sm (styles.md §3)
export const GRID_ROOT_CLASS = "ss-grid";
export const GRID_CONTAINER_CLASS = "ss-grid-container";
