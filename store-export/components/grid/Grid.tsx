"use client";

import { useCallback, useId, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoveDiagonal2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  GRID_CELL_RADIUS_CLASS,
  GRID_COLUMNS_DESKTOP,
  GRID_COLUMNS_MOBILE,
  GRID_CONTAINER_CLASS,
  GRID_ROOT_CLASS,
  SIZE_SPANS,
  clampSpanToColumns,
  trailingPlaceholderCount,
  type GridBlock,
  type GridSize,
  type GridSpan,
  type RenderGridBlock,
} from "./gridConstants";
import { useResizable } from "./useResizable";

// PRESENTATION-AGNOSTIC bento grid. Renders CELLS from a layout array + a
// render function; it never references product/artifact fields. `editable`
// toggles drag-to-reorder + corner resize (builder) ON, or renders a static
// read-only grid (marketplace) OFF. Same component, two modes.
//
// Layout mechanics (fixed columns, equal gap, TRUE-SQUARE cells) live in the
// `.ss-grid` rule in globals.css; column counts are injected here as CSS vars.

// Handle chrome — token-only. Hidden until hover/focus on fine pointers,
// always visible on coarse (touch) pointers, which have no hover.
const HANDLE_CLASS = cn(
  "absolute z-20 inline-flex size-6 items-center justify-center rounded-sm border border-border",
  "bg-background/95 text-muted-foreground shadow-xs transition-opacity duration-180 ease-in-out",
  "hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "motion-reduce:transition-none",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
);

function spanStyle(span: GridSpan): React.CSSProperties {
  return {
    gridColumnEnd: `span ${span.colSpan}`,
    gridRowEnd: `span ${span.rowSpan}`,
  };
}

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

/** A dashed empty grid slot (open drop target). Decorative; not sortable. */
function PlaceholderCell({ cellClassName }: { cellClassName?: string }) {
  return (
    <li
      aria-hidden="true"
      className={cn(
        "pointer-events-none border border-dashed border-border bg-background/40",
        GRID_CELL_RADIUS_CLASS,
        cellClassName,
      )}
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

// --- editable grid + cell -------------------------------------------------

function EditableGrid<TData>({
  ordered,
  rootStyle,
  columns,
  renderBlock,
  onReorder,
  onResize,
  ariaLabel,
  getBlockLabel,
  className,
  cellClassName,
  placeholderCount,
  dragOnCell,
}: {
  ordered: GridBlock<TData>[];
  rootStyle: React.CSSProperties;
  columns: number;
  renderBlock: RenderGridBlock<TData>;
  onReorder?: (activeKey: string, overKey: string) => void;
  onResize?: (key: string, size: GridSize) => void;
  ariaLabel: string;
  getBlockLabel?: (block: GridBlock<TData>) => string;
  className?: string;
  cellClassName?: string;
  placeholderCount: number;
  dragOnCell: boolean;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Stable id keeps dnd-kit's generated aria ids identical across SSR/CSR.
  const dndId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeBlock = useMemo(
    () => ordered.find((block) => block.key === activeKey) ?? null,
    [ordered, activeKey],
  );

  const handleResize = useCallback(
    (key: string, size: GridSize) => onResize?.(key, size),
    [onResize],
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveKey(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveKey(null);
    if (over && active.id !== over.id) {
      onReorder?.(String(active.id), String(over.id));
    }
  }

  return (
    <div className={cn(GRID_CONTAINER_CLASS, className)}>
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveKey(null)}
      >
        <SortableContext
          items={ordered.map((block) => block.key)}
          strategy={rectSortingStrategy}
        >
          <ul
            aria-label={ariaLabel}
            className={cn(GRID_ROOT_CLASS, "m-0 list-none p-0")}
            style={rootStyle}
          >
            {ordered.map((block) => (
              <EditableCell
                key={block.key}
                block={block}
                columns={columns}
                renderBlock={renderBlock}
                onResize={handleResize}
                label={getBlockLabel?.(block)}
                cellClassName={cellClassName}
                dragOnCell={dragOnCell}
              />
            ))}
            {/* Dashed open slots after the real blocks. They auto-flow into the
                grid's empty cells + a growth row, so the grid reads as a grid.
                Not sortable (outside SortableContext.items). */}
            {Array.from({ length: placeholderCount }, (_, index) => (
              <PlaceholderCell key={`empty-${index}`} cellClassName={cellClassName} />
            ))}
          </ul>
        </SortableContext>

        {/* Floating copy that follows the cursor while dragging — the clearest
            cue for what is moving and where it will land. Sized by dnd-kit to
            the dragged tile's rect, so no span classes are needed. The overlay
            adds no border/background of its own (the grid is presentation-
            agnostic): renderBlock is responsible for painting an opaque
            surface, exactly as it does for the in-place cells. */}
        <DragOverlay dropAnimation={null}>
          {activeBlock ? (
            <div
              className={cn(
                "h-full w-full overflow-hidden shadow-lg",
                GRID_CELL_RADIUS_CLASS,
                cellClassName,
              )}
            >
              {renderBlock(activeBlock, {
                editable: true,
                isDragging: true,
                isResizing: false,
                previewSize: activeBlock.size,
              })}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function EditableCell<TData>({
  block,
  columns,
  renderBlock,
  onResize,
  label,
  cellClassName,
  dragOnCell,
}: {
  block: GridBlock<TData>;
  columns: number;
  renderBlock: RenderGridBlock<TData>;
  onResize: (key: string, size: GridSize) => void;
  label?: string;
  cellClassName?: string;
  dragOnCell: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: block.key });
  const resizeCommit = useCallback(
    (size: GridSize) => onResize(block.key, size),
    [onResize, block.key],
  );
  const { previewSize, isResizing, setCellRef, handleProps } = useResizable({
    size: block.size,
    columns,
    onResize: resizeCommit,
    label,
  });

  // One element carries both the sortable node ref and the resize measure ref.
  const setRefs = useCallback(
    (node: HTMLLIElement | null) => {
      setNodeRef(node);
      setCellRef(node);
    },
    [setNodeRef, setCellRef],
  );

  const span = clampSpanToColumns(SIZE_SPANS[previewSize], columns);
  const dragListeners = listeners ?? {};

  // Whole-surface drag (dragOnCell): reuse the sortable pointer activator on
  // the cell itself, skipping presses that land on the cell's own buttons
  // (grip, resize, tile controls) so their clicks keep working. The grip
  // still carries the pointer/keyboard/touch path for a11y.
  const cellPointerDown = dragListeners.onPointerDown as
    | React.PointerEventHandler<HTMLLIElement>
    | undefined;
  const handleCellPointerDown: React.PointerEventHandler<HTMLLIElement> = (
    event,
  ) => {
    if ((event.target as HTMLElement).closest("button")) return;
    cellPointerDown?.(event);
  };

  return (
    <li
      ref={setRefs}
      data-grid-cell=""
      onPointerDown={dragOnCell ? handleCellPointerDown : undefined}
      style={{
        ...spanStyle(span),
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group relative overflow-hidden",
        GRID_CELL_RADIUS_CLASS,
        cellClassName,
        dragOnCell && "cursor-grab active:cursor-grabbing",
        // The DragOverlay carries the floating copy; the in-place tile stays a
        // dimmed placeholder so the drop slot reads clearly.
        isDragging && "z-10 opacity-40",
      )}
    >
      {renderBlock(block, {
        editable: true,
        isDragging,
        isResizing,
        previewSize,
      })}

      {/* Drag-to-reorder handle (pointer + keyboard, via dnd-kit). */}
      <button
        type="button"
        aria-label={label ? `Reorder ${label}` : "Reorder block"}
        className={cn(HANDLE_CLASS, "left-1 top-1 cursor-grab touch-none active:cursor-grabbing")}
        {...attributes}
        {...dragListeners}
      >
        <GripVertical className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>

      {/* Corner resize handle: drags to snap 1x1 / 2x1 / 2x2, arrows resize. */}
      <button
        type="button"
        className={cn(
          HANDLE_CLASS,
          "bottom-1 right-1 cursor-nwse-resize touch-none select-none",
        )}
        {...handleProps}
      >
        <MoveDiagonal2 className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}
