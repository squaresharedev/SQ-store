"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import {
  GRID_CELL_RADIUS_CLASS,
  GRID_COLUMNS_DESKTOP,
  GRID_COLUMNS_MOBILE,
  GRID_CONTAINER_CLASS,
  GRID_ROOT_CLASS,
  SIZE_SPANS,
  clampSpanToColumns,
  spanStyle,
  trailingPlaceholderCount,
  type GridBlock,
  type GridSize,
  type RenderGridBlock,
} from "./gridConstants";
import type { EditableGridProps } from "./EditableGrid";

// The drag/resize half (dnd-kit, ~60KB gz) is loaded ONLY when an editable grid
// actually renders. Read-only consumers of this primitive — the storefront
// list's card previews, and later the marketplace — take the StaticCell path
// below and never fetch that chunk. Prerendering stays ON (no `ssr: false`), so
// the designer's first paint is unchanged; only the client chunk is deferred.
// `dynamic()` erases generics, so re-assert the generic call signature.
const EditableGrid = dynamic(() => import("./EditableGrid")) as <TData>(
  props: EditableGridProps<TData>,
) => React.ReactElement;

// PRESENTATION-AGNOSTIC bento grid. Renders CELLS from a layout array + a
// render function; it never references product/artifact fields. `editable`
// toggles drag-to-reorder + corner resize (builder) ON, or renders a static
// read-only grid (marketplace) OFF. Same component, two modes.
//
// Layout mechanics (fixed columns, equal gap, TRUE-SQUARE cells) live in the
// `.ss-grid` rule in globals.css; column counts are injected here as CSS vars.

/** The two CSS custom properties the `.ss-grid` rule reads. Typed (not cast)
 *  so a typo in a var name is a compile error, not a silent CSS fallback. */
type GridVars = React.CSSProperties & {
  "--ss-cols-desktop": number;
  "--ss-cols-mobile": number;
};

interface GridCommonProps<TData> {
  blocks: GridBlock<TData>[];
  renderBlock: RenderGridBlock<TData>;
  /** Desktop column count (≥ sm). INVARIANT: `mobileColumns` ≤ `columns`. */
  columns?: number;
  /** Column count under the sm breakpoint. Must be ≥ the widest span (2). */
  mobileColumns?: number;
  /** Accessible name for the grid list. */
  ariaLabel?: string;
  /** Accessible name per block, for the drag/resize handles (editable mode). */
  getBlockLabel?: (block: GridBlock<TData>) => string;
  className?: string;
  /** Extra classes for each cell surface (e.g. a theme radius). Overrides the
   *  default `rounded-sm` via tailwind-merge; the square sizing is unaffected. */
  cellClassName?: string;
  /** Render dashed empty-slot placeholders in the grid's open cells, so the
   *  grid reads as a grid (drop targets), not just floating tiles. */
  showEmptyCells?: boolean;
  /** Extra empty rows to show below the content when showEmptyCells (default 1). */
  emptyRows?: number;
  /** Editable mode only: make the WHOLE cell surface a drag-to-reorder target
   *  (Figma-style direct manipulation), not just the grip. Presses on the
   *  cell's own buttons (grip, resize, tile controls) are ignored so their
   *  clicks still work; the grip keeps the keyboard + touch path. */
  dragOnCell?: boolean;
}

/**
 * OFF = static read-only grid (marketplace); callbacks are rejected. ON =
 * drag-resize + reorder; the callbacks are REQUIRED at the type level so an
 * editable grid can never silently drop its mutations.
 */
export type GridProps<TData> =
  | (GridCommonProps<TData> & {
      editable?: false;
      onReorder?: undefined;
      onResize?: undefined;
    })
  | (GridCommonProps<TData> & {
      editable: true;
      onReorder: (activeKey: string, overKey: string) => void;
      onResize: (key: string, size: GridSize) => void;
    });

export function Grid<TData>(props: GridProps<TData>) {
  const {
    blocks,
    renderBlock,
    editable = false,
    columns = GRID_COLUMNS_DESKTOP,
    mobileColumns = GRID_COLUMNS_MOBILE,
    onReorder,
    onResize,
    ariaLabel = "Grid",
    getBlockLabel,
    className,
    cellClassName,
    showEmptyCells = false,
    emptyRows = 1,
    dragOnCell = false,
  } = props;

  const ordered = useMemo(
    () => [...blocks].sort((a, b) => a.order - b.order),
    [blocks],
  );

  // Clamp spans to the NARROWEST breakpoint's track count, so a block's static
  // `grid-column-end: span N` can never overflow the grid (the CSS switches the
  // column count responsively, but the inline span does not).
  const clampColumns = Math.min(columns, mobileColumns);

  // Number of dashed empty-slot cells to append (editable builder only). Sized
  // at the desktop column count; auto-flow adapts them at the mobile breakpoint.
  const placeholderCount = useMemo(
    () =>
      editable && showEmptyCells
        ? trailingPlaceholderCount(
            ordered.map((block) => SIZE_SPANS[block.size]),
            columns,
            emptyRows,
          )
        : 0,
    [editable, showEmptyCells, ordered, columns, emptyRows],
  );

  // Injects the responsive column counts the `.ss-grid` rule reads.
  const rootStyle: GridVars = {
    "--ss-cols-desktop": columns,
    "--ss-cols-mobile": mobileColumns,
  };

  if (!editable) {
    return (
      <div className={cn(GRID_CONTAINER_CLASS, className)}>
        <ul
          aria-label={ariaLabel}
          className={cn(GRID_ROOT_CLASS, "m-0 list-none p-0")}
          style={rootStyle}
        >
          {ordered.map((block) => (
            <StaticCell
              key={block.key}
              block={block}
              columns={clampColumns}
              renderBlock={renderBlock}
              cellClassName={cellClassName}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <EditableGrid
      ordered={ordered}
      rootStyle={rootStyle}
      columns={clampColumns}
      renderBlock={renderBlock}
      onReorder={onReorder}
      onResize={onResize}
      ariaLabel={ariaLabel}
      getBlockLabel={getBlockLabel}
      className={className}
      cellClassName={cellClassName}
      placeholderCount={placeholderCount}
      dragOnCell={dragOnCell}
    />
  );
}

// --- read-only cell -------------------------------------------------------

function StaticCell<TData>({
  block,
  columns,
  renderBlock,
  cellClassName,
}: {
  block: GridBlock<TData>;
  columns: number;
  renderBlock: RenderGridBlock<TData>;
  cellClassName?: string;
}) {
  const span = clampSpanToColumns(SIZE_SPANS[block.size], columns);
  return (
    <li
      style={spanStyle(span)}
      className={cn("relative overflow-hidden", GRID_CELL_RADIUS_CLASS, cellClassName)}
    >
      {renderBlock(block, {
        editable: false,
        isDragging: false,
        isResizing: false,
        previewSize: block.size,
      })}
    </li>
  );
}
