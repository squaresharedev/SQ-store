import type { ReactNode } from "react";

// Shared, presentation-agnostic constants + types for the bento grid primitive.
// Reused by BOTH the storefront builder and (later) the marketplace. Nothing in
// here references product- or artifact-specific fields — the grid only ever
// knows about a stable key, a size, an order, and an opaque `data` payload.

/**
 * The closed set of allowed block sizes as `columns×rows`. Mirrors the
 * storefront size model (types/storefront.ts `BLOCK_SIZES`) but is OWNED here so
 * the grid stays independent of any feature. A consumer whose own size union is
 * the same string literals (e.g. storefront `BlockSize`) assigns cleanly.
 */
// Every rectangle from 1×1 up to 3×3 (`<cols>x<rows>`), so blocks can be small,
// wide, tall, or large squares — plenty of shape variety for a bento layout.
export const GRID_SIZES = [
  "1x1", "2x1", "3x1",
  "1x2", "2x2", "3x2",
  "1x3", "2x3", "3x3",
] as const;
export type GridSize = (typeof GRID_SIZES)[number];

export interface GridSpan {
  colSpan: number;
  rowSpan: number;
}

/** Parse a `<cols>x<rows>` size into its numeric span. */
function parseSize(size: GridSize): GridSpan {
  const [colSpan, rowSpan] = size.split("x").map(Number);
  return { colSpan, rowSpan };
}

/** Size → track span. The single source of truth for how big a block is. */
export const SIZE_SPANS: Record<GridSize, GridSpan> = Object.fromEntries(
  GRID_SIZES.map((size) => [size, parseSize(size)]),
) as Record<GridSize, GridSpan>;

/** Human labels used for a11y (`aria-valuetext` on the resize handle). */
export const SIZE_LABELS: Record<GridSize, string> = Object.fromEntries(
  GRID_SIZES.map((size) => {
    const { colSpan, rowSpan } = SIZE_SPANS[size];
    return [size, `${colSpan} wide by ${rowSpan} tall`];
  }),
) as Record<GridSize, string>;

/**
 * Default responsive column counts (styles.md §8.9 bento grid, §10 breakpoints).
 * Consumers can override; the storefront builder uses a finer 6/3 grid. The
 * mobile count must be ≥ the widest span (3); if a consumer passes fewer, the
 * Grid clamps spans down to it (see clampSpanToColumns) so nothing overflows.
 */
export const GRID_COLUMNS_DESKTOP = 4;
export const GRID_COLUMNS_MOBILE = 2;

/** Widest span the size set can produce, in either axis (up to 3×3). */
export const MAX_COL_SPAN = 3;
export const MAX_ROW_SPAN = 3;

/**
 * Clamp a raw span to the available columns so a block can never overflow the
 * track count on a narrow layout. Rows are left unbounded (the grid grows down).
 */
export function clampSpanToColumns(span: GridSpan, columns: number): GridSpan {
  return {
    colSpan: Math.max(1, Math.min(span.colSpan, columns)),
    rowSpan: Math.max(1, span.rowSpan),
  };
}

/**
 * Snap an arbitrary desired `(cols, rows)` — e.g. derived from a resize drag —
 * to an ALLOWED size. Every rectangle up to 3×3 exists, so this just rounds and
 * clamps into range; the guard keeps a resize from ever producing a size that
 * is not a member of the set.
 */
export function snapToSize(cols: number, rows: number): GridSize {
  const c = Math.min(Math.max(1, Math.round(cols)), MAX_COL_SPAN);
  const r = Math.min(Math.max(1, Math.round(rows)), MAX_ROW_SPAN);
  const candidate = `${c}x${r}`;
  return (GRID_SIZES as readonly string[]).includes(candidate)
    ? (candidate as GridSize)
    : "1x1";
}

/**
 * Simulate CSS sparse row auto-placement to find how many ROWS the given spans
 * occupy at a column count. Used to size the empty-slot placeholders so the
 * grid reads as a grid (open drop targets), not just floating tiles.
 */
function occupiedRows(spans: GridSpan[], columns: number): number {
  const occupied = new Set<number>();
  const at = (r: number, c: number) => r * columns + c;
  const fits = (r: number, c: number, rs: number, cs: number): boolean => {
    for (let rr = r; rr < r + rs; rr += 1)
      for (let cc = c; cc < c + cs; cc += 1)
        if (occupied.has(at(rr, cc))) return false;
    return true;
  };
  let curR = 0;
  let curC = 0;
  let maxRow = 0;
  for (const span of spans) {
    const cs = Math.min(span.colSpan, columns);
    const rs = span.rowSpan;
    let r = curR;
    let c = curC;
    while (true) {
      if (c + cs > columns) {
        r += 1;
        c = 0;
        continue;
      }
      if (fits(r, c, rs, cs)) break;
      c += 1;
    }
    for (let rr = r; rr < r + rs; rr += 1)
      for (let cc = c; cc < c + cs; cc += 1) occupied.add(at(rr, cc));
    maxRow = Math.max(maxRow, r + rs);
    curR = r;
    curC = c + cs;
    if (curC >= columns) {
      curR = r + 1;
      curC = 0;
    }
  }
  return maxRow;
}

/**
 * How many trailing 1×1 placeholder cells to append after the real blocks so
 * the grid shows its empty slots: enough to complete the last partial row plus
 * `growthRows` extra rows (drop-target hint). Computed at the desktop column
 * count; auto-flow adapts the same cells to the mobile count at render time.
 */
export function trailingPlaceholderCount(
  spans: GridSpan[],
  columns: number,
  growthRows: number,
): number {
  if (spans.length === 0) return 0;
  const rows = occupiedRows(spans, columns);
  const filledArea = spans.reduce(
    (sum, span) => sum + Math.min(span.colSpan, columns) * span.rowSpan,
    0,
  );
  const emptyInBox = Math.max(0, rows * columns - filledArea);
  return emptyInBox + columns * Math.max(0, growthRows);
}

/**
 * A single grid item. `data` is an opaque consumer payload — the grid never
 * inspects it, which is what keeps the primitive presentation-agnostic and
 * reusable across the builder (blocks) and the marketplace (artifacts).
 */
export interface GridBlock<TData = unknown> {
  /** Stable identity: doubles as the sortable id and the React key. */
  key: string;
  size: GridSize;
  order: number;
  data: TData;
}

/** Per-render state the grid hands to `renderBlock`, for content-level styling. */
export interface GridBlockState {
  editable: boolean;
  isDragging: boolean;
  isResizing: boolean;
  /** Live size during a resize drag; equals `block.size` when idle. */
  previewSize: GridSize;
}

/**
 * Consumer-supplied render function. Receives the block + transient state.
 * The grid provides only the square cell shape (radius + overflow clip) and,
 * in editable mode, the drag/resize handles — renderBlock is responsible for
 * painting its own opaque surface (background/border), including in the drag
 * overlay, since the grid stays presentation-agnostic.
 */
export type RenderGridBlock<TData> = (
  block: GridBlock<TData>,
  state: GridBlockState,
) => ReactNode;

// Token class references (styles.md). Kept here so no component hardcodes the
// radius; the gap + square-cell mechanics live in the `.ss-grid` rule in
// globals.css (driven by the --grid-gap token + injected column counts).
export const GRID_CELL_RADIUS_CLASS = "rounded-sm"; // --radius-sm (styles.md §3)
export const GRID_ROOT_CLASS = "ss-grid";
export const GRID_CONTAINER_CLASS = "ss-grid-container";
