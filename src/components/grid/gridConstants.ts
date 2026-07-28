import type { ReactNode } from "react";

// Shared, presentation-agnostic constants + placement math for the canvas
// grid. Reused by BOTH the storefront builder and (later) the marketplace.
// Nothing here references product- or artifact-specific fields: the grid only
// ever knows a stable key, a placement, and an opaque `data` payload.
//
// PLACEMENT MODEL: every block states where it sits (x, y) and how many cells
// it covers (w, h) on a fixed columns x rows board. There is no auto-flow, so
// the gaps between blocks are deliberate. Placements never overlap and never
// leave the board; the helpers below are the single source of truth for both
// rules, used by the editor, the schema, and the server.

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

/** Is this placement wholly inside a columns x rows board? */
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

/** Can `candidate` go here — inside the board, and clear of every other block? */
export function placementIsFree(
  blocks: readonly GridBlock<unknown>[],
  candidate: GridPlacement,
  ignoreKey: string | null,
  columns: number,
  rows: number,
): boolean {
  if (!withinCanvas(candidate, columns, rows)) return false;
  return !blocks.some(
    (block) => block.key !== ignoreKey && placementsOverlap(block, candidate),
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
