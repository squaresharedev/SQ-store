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
  GRID_CONTAINER_CLASS,
  GRID_ROOT_CLASS,
  SIZE_SPANS,
  clampSpanToColumns,
  spanStyle,
  type GridBlock,
  type GridSize,
  type RenderGridBlock,
} from "./gridConstants";
import { useResizable } from "./useResizable";

// EDITABLE half of the bento grid: drag-to-reorder (dnd-kit) + corner resize.
// Split out of Grid.tsx and loaded via next/dynamic so the ~60KB dnd-kit runtime
// only ships to routes that actually render an editable grid (the storefront
// designer) — NOT to read-only consumers of the same primitive (the storefront
// list's card previews, and later the marketplace), which render StaticCell.
// Keep every dnd-kit import in this file; adding one to Grid.tsx undoes the split.

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

export interface EditableGridProps<TData> {
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

export default function EditableGrid<TData>({
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
}: EditableGridProps<TData>) {
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
