import type { ReactNode } from "react";
import { rotatedFootprint } from "@/lib/geometry/rotated-box";

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
}

// PAINT ORDER BANDS. In ONE place because everything below shares a single
// stacking context: grid cells are siblings, so their z-indexes are compared
// against each other in the nearest stacking-context ancestor (the designer's
// stage, which makes one with `willChange: transform`). A cell's own CONTENTS
// are already isolated by `contain: layout` on `.ss-grid > *` (globals.css),
// so a tile's chip, badges and framer need none of this.
//
// Content sits at the bottom of the range and is clamped to the ceiling, so a
// board can never stack a block over the editor's own affordances however many
// blocks it holds.

/** Where a block's depth starts. Block z 0..n-1 maps onto this. */
export const LAYER_Z_BASE = 1;
/** Nothing content-driven paints above this, whatever a board's block count. */
export const LAYER_Z_CEILING = 500;
/** A tile lifted off the board by a drag or a resize. */
export const GESTURE_Z = 600;
/** A tile whose image is being framed, spilling past its own cell. */
export const FRAME_Z = 600;
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
 * Can `candidate` go here — inside the board, and clear of every other block?
 *
 * Every OTHER block is measured by its footprint, so a tilted neighbour is
 * considered where it paints rather than where it is placed. Somewhere a
 * turned bar visibly covers is not somewhere empty, whatever its stored rect
 * says.
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
): boolean {
  if (!withinCanvas(candidate, columns, rows)) return false;
  return !blocks.some(
    (block) =>
      block.key !== ignoreKey &&
      placementsOverlap(blockFootprint(block), candidate),
  );
}

/** First free spot for a w x h block, scanning row by row. Null when full. */
export function findFreeCell(
  blocks: readonly GridBlock<unknown>[],
  w: number,
  h: number,
  columns: number,
  rows: number,
): { x: number; y: number } | null {
  for (let y = 0; y + h <= rows; y += 1) {
    for (let x = 0; x + w <= columns; x += 1) {
      if (placementIsFree(blocks, { x, y, w, h }, null, columns, rows)) {
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
 */
export function reflowBlocks<TData>(
  blocks: readonly GridBlock<TData>[],
  designColumns: number,
  renderColumns: number,
): { blocks: GridBlock<TData>[]; rows: number } {
  const ratio = renderColumns / designColumns;
  const ordered = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const scaled = ordered.map((block) => ({
    w: Math.min(renderColumns, Math.max(1, Math.round(block.w * ratio))),
    h: Math.max(1, Math.round(block.h * ratio)),
  }));

  const packed = packFirstFit(scaled, renderColumns);
  let rows = 0;
  const placed = ordered.map((block, index) => {
    rows = Math.max(rows, packed[index].rows);
    return {
      ...block,
      x: packed[index].x,
      y: packed[index].y,
      w: scaled[index].w,
      h: scaled[index].h,
    };
  });
  return { blocks: placed, rows };
}

// EDGE-GRAB RESIZE. A press near a cell's border resizes from that side
// (corners combine two sides); a press on the inner surface stays a move.
// The hit-test and the placement math live here, pure, so the gesture wiring
// in Grid.tsx stays thin and this part stays unit-testable.
//
// Everything below works on the box the seller can SEE, which for a turned
// block is its footprint rather than its stored rect. That is what makes a
// resize behave: the edge under the hand is the edge that moves, and it moves
// the way the hand does. Reading the pointer in the block's own turned space
// instead looks right at zero degrees and inverts at half a turn, where
// dragging the top edge upwards would grow the block downwards.

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
 * `rect` is the box the seller sees: the FOOTPRINT's box for a turned block,
 * the cell's own for a level one. Both are axis aligned, so north here is
 * north on screen, and the edge that comes back is the edge under the hand.
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
 * The placement after dragging the given edges to the cell under the cursor.
 * Dragged sides follow the cursor; the opposite sides stay pinned, and the
 * span never collapses below one cell or leaves the board.
 */
export function resizeByEdges(
  origin: GridPlacement,
  edges: ResizeEdges,
  col: number,
  row: number,
  columns: number,
  rows: number,
): GridPlacement {
  const right = origin.x + origin.w;
  const bottom = origin.y + origin.h;
  const cursorCol = Math.min(Math.max(col, 0), columns - 1);
  const cursorRow = Math.min(Math.max(row, 0), rows - 1);
  let { x, y, w, h } = origin;
  if (edges.w) {
    x = Math.min(cursorCol, right - 1);
    w = right - x;
  } else if (edges.e) {
    w = Math.max(1, cursorCol - origin.x + 1);
  }
  if (edges.n) {
    y = Math.min(cursorRow, bottom - 1);
    h = bottom - y;
  } else if (edges.s) {
    h = Math.max(1, cursorRow - origin.y + 1);
  }
  return { x, y, w, h };
}

/**
 * The standard resize cursor for a set of grabbed edges.
 *
 * No rotation to account for: the edges come from the footprint, which is
 * axis aligned, so an edge that faces up on screen is the one that grows
 * upwards when it is dragged.
 */
export function edgeCursor(edges: ResizeEdges): string {
  const vertical = edges.n || edges.s;
  const horizontal = edges.e || edges.w;
  if (vertical && horizontal) {
    const falling = (edges.n && edges.w) || (edges.s && edges.e);
    return falling ? "nwse-resize" : "nesw-resize";
  }
  return vertical ? "ns-resize" : "ew-resize";
}

/** Per-render state the grid hands to `renderBlock`, for content-level styling. */
export interface GridBlockState {
  editable: boolean;
  isDragging: boolean;
  isResizing: boolean;
  /** Live placement during a drag/resize; the committed one when idle. */
  placement: GridPlacement;
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

// Token class references (styles.md). Kept here so no component hardcodes the
// radius; the gap + square-cell mechanics live in the `.ss-grid` rule in
// globals.css (driven by the --grid-gap token + injected column/row counts).
export const GRID_CELL_RADIUS_CLASS = "rounded-sm"; // --radius-sm (styles.md §3)
export const GRID_ROOT_CLASS = "ss-grid";
export const GRID_CONTAINER_CLASS = "ss-grid-container";
