"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveDiagonal2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  GRID_CELL_RADIUS_CLASS,
  GRID_COLUMNS_DEFAULT,
  GRID_CONTAINER_CLASS,
  GRID_ROOT_CLASS,
  GRID_ROWS_DEFAULT,
  clampToCanvas,
  columnsThatFit,
  placementIsFree,
  reflowBlocks,
  type GridBlock,
  type GridPlacement,
  type RenderGridBlock,
} from "./gridConstants";

// PRESENTATION-AGNOSTIC canvas grid. Renders CELLS at the coordinates their
// blocks state; it never references product/artifact fields. `editable`
// toggles free drag + corner resize (builder) ON, or renders a static
// read-only board (marketplace) OFF. Same component, two modes.
//
// Layout mechanics (square cells sized off the container) live in the
// `.ss-grid` rule in globals.css; the column and row counts are injected here
// as CSS vars.
//
// RESPONSIVE: below the width where cells stay legible the grid stops
// honouring coordinates and reflows (see reflowBlocks) into as many columns as
// fit. Editing is disabled while reflowed — the seller would be dragging a
// layout that is not the one being stored.

/** Pointer travel (px) before a press on a cell becomes a drag rather than a
 *  click. Matches the threshold the tile's own click guard uses. */
const DRAG_THRESHOLD = 4;

/** Handle chrome — token-only. Hidden until hover/focus on fine pointers,
 *  always visible on coarse (touch) pointers, which have no hover. */
const HANDLE_CLASS = cn(
  "absolute z-20 inline-flex size-6 items-center justify-center rounded-sm border border-border",
  "bg-background/95 text-muted-foreground shadow-xs transition-opacity duration-180 ease-in-out",
  "hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "motion-reduce:transition-none",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
);

/** Suppress text selection for the duration of a drag. Module scope so the
 *  DOM write happens outside component/render scope. */
function setDragCursorLock(locked: boolean): void {
  document.body.style.userSelect = locked ? "none" : "";
}

function placementStyle(placement: GridPlacement): React.CSSProperties {
  return {
    gridColumn: `${placement.x + 1} / span ${placement.w}`,
    gridRow: `${placement.y + 1} / span ${placement.h}`,
  };
}

/** The two CSS custom properties the `.ss-grid` rule reads. Typed (not cast)
 *  so a typo in a var name is a compile error, not a silent CSS fallback. */
type GridVars = React.CSSProperties & {
  "--ss-cols": number;
  "--ss-rows": number;
};

/**
 * A live drag or resize, previewed before it is committed.
 *
 * The tile always keeps its committed cell in the layout and is drawn
 * off-grid: MOVING translates it by `offset`, RESIZING stretches it to
 * `size` (both in unscaled px, so they track the cursor at any zoom).
 * `placement` is the cell it would snap into, drawn as a ghost underneath.
 * Snapping the tile itself would make it jump cell to cell, which reads as
 * laggy rather than direct.
 */
type ActiveGesture = {
  key: string;
  mode: "move" | "resize";
  placement: GridPlacement;
  valid: boolean;
  offset: { x: number; y: number };
  size?: { w: number; h: number };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface GridCommonProps<TData> {
  blocks: GridBlock<TData>[];
  renderBlock: RenderGridBlock<TData>;
  /** Canvas size in cells. */
  columns?: number;
  rows?: number;
  /** Accessible name for the grid list. */
  ariaLabel?: string;
  /** Accessible name per block, for its drag/resize affordances. */
  getBlockLabel?: (block: GridBlock<TData>) => string;
  className?: string;
  /** Extra classes for each cell surface (e.g. a theme radius). */
  cellClassName?: string;
  /** Inline styles per cell, for values classes can't express (e.g. a numeric
   *  border-radius that scales with the block's span). */
  cellStyle?: (placement: GridPlacement) => React.CSSProperties;
  /** Draw the free cells, so the board reads as a board. Editable only. */
  showEmptyCells?: boolean;
  /** Click a free cell (editable only) — used to insert right there. */
  onEmptyCellClick?: (x: number, y: number) => void;
}

/**
 * OFF = static read-only board (marketplace); callbacks are rejected. ON =
 * free placement + resize; the callbacks are REQUIRED at the type level so an
 * editable grid can never silently drop its mutations.
 */
export type GridProps<TData> =
  | (GridCommonProps<TData> & {
      editable?: false;
      onMove?: undefined;
      onResize?: undefined;
    })
  | (GridCommonProps<TData> & {
      editable: true;
      onMove: (key: string, x: number, y: number) => void;
      onResize: (key: string, w: number, h: number) => void;
    });

export function Grid<TData>(props: GridProps<TData>) {
  const {
    blocks,
    renderBlock,
    editable = false,
    columns = GRID_COLUMNS_DEFAULT,
    rows = GRID_ROWS_DEFAULT,
    onMove,
    onResize,
    ariaLabel = "Grid",
    getBlockLabel,
    className,
    cellClassName,
    cellStyle,
    showEmptyCells = false,
    onEmptyCellClick,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const [metrics, setMetrics] = useState({ width: 0, gap: 0 });
  const [active, setActive] = useState<ActiveGesture | null>(null);
  // Teardown for an in-flight gesture, so unmounting mid-drag detaches the
  // window listeners instead of leaking them.
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  // Measure LAYOUT width (clientWidth ignores any zoom transform on an
  // ancestor), so zooming never changes which responsive tier we are in.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const grid = gridRef.current;
      const gap = grid
        ? Number.parseFloat(getComputedStyle(grid).columnGap) || 0
        : 0;
      setMetrics({ width: container.clientWidth, gap });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const renderColumns =
    metrics.width > 0
      ? columnsThatFit(metrics.width, metrics.gap, columns)
      : columns;

  // Exact tier: coordinates are honoured. Reflow tier: they are not, so the
  // board is read-only until it has room again.
  const view = useMemo(() => {
    if (renderColumns >= columns) {
      return { blocks, rows, reflowed: false };
    }
    const reflowed = reflowBlocks(blocks, columns, renderColumns);
    return {
      blocks: reflowed.blocks,
      rows: Math.max(reflowed.rows, 1),
      reflowed: true,
    };
  }, [blocks, columns, rows, renderColumns]);

  const interactive = editable && !view.reflowed;

  const rootStyle: GridVars = {
    "--ss-cols": renderColumns,
    "--ss-rows": view.rows,
  };

  /** Cell pitch in SCREEN px. Both the grid rect and the pointer deltas are
   *  post-transform, so a zoomed canvas needs no extra compensation. */
  const readStrides = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const gapX = Number.parseFloat(style.columnGap) || 0;
    const gapY = Number.parseFloat(style.rowGap) || 0;
    const cellW = (rect.width - (renderColumns - 1) * gapX) / renderColumns;
    const cellH = (rect.height - (view.rows - 1) * gapY) / view.rows;
    // Zoom factor, derived rather than passed in: getBoundingClientRect is
    // post-transform while offsetWidth is the layout width, so their ratio IS
    // the scale of every ancestor combined.
    const scale = grid.offsetWidth > 0 ? rect.width / grid.offsetWidth : 1;
    return {
      rect,
      gapX,
      gapY,
      scale,
      strideX: cellW + gapX,
      strideY: cellH + gapY,
    };
  }, [renderColumns, view.rows]);

  /** Shared teardown for both gestures. */
  const endGesture = useCallback(
    (onMoveHandler: (event: PointerEvent) => void, onUp: () => void) => {
      window.removeEventListener("pointermove", onMoveHandler);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragCursorLock(false);
      cleanupRef.current = null;
      setActive(null);
    },
    [],
  );

  function startMove(
    event: React.PointerEvent<HTMLLIElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive || event.button !== 0) return;
    // Presses on the cell's own controls (remove, resize) keep their behavior.
    if ((event.target as HTMLElement).closest("button")) return;
    const strides = readStrides();
    if (!strides) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const origin: GridPlacement = {
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
    };
    let dragging = false;
    let latest = origin;
    let latestValid = true;

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      // A short press is a click (select); only real travel starts a drag.
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        setDragCursorLock(true);
      }
      const candidate = clampToCanvas(
        {
          ...origin,
          x: origin.x + Math.round(dx / strides.strideX),
          y: origin.y + Math.round(dy / strides.strideY),
        },
        columns,
        rows,
      );
      latest = candidate;
      latestValid = placementIsFree(blocks, candidate, block.key, columns, rows);
      setActive({
        key: block.key,
        mode: "move",
        placement: candidate,
        valid: latestValid,
        // Unscaled, so the tile tracks the cursor 1:1 at any zoom.
        offset: { x: dx / strides.scale, y: dy / strides.scale },
      });
    };

    const handleUp = () => {
      endGesture(handleMove, handleUp);
      // An invalid drop springs back: committing would overlap a neighbour.
      if (!dragging || !latestValid) return;
      if (latest.x !== origin.x || latest.y !== origin.y) {
        onMove?.(block.key, latest.x, latest.y);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    cleanupRef.current = () => endGesture(handleMove, handleUp);
  }

  function startResize(
    event: React.PointerEvent<HTMLButtonElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive || event.button !== 0) return;
    // Never let a resize also start a move.
    event.preventDefault();
    event.stopPropagation();
    const strides = readStrides();
    const cell = event.currentTarget.closest("li");
    if (!strides || !cell) return;

    const rect = cell.getBoundingClientRect();
    let latest: GridPlacement = { x: block.x, y: block.y, w: block.w, h: block.h };
    let latestValid = true;
    setDragCursorLock(true);

    // Pixel bounds for the live preview: at least one cell, at most the room
    // left on the board. Unscaled, so the edge tracks the cursor at any zoom.
    const cellW = strides.strideX - strides.gapX;
    const cellH = strides.strideY - strides.gapY;
    const roomCols = columns - block.x;
    const roomRows = rows - block.y;
    const minW = cellW / strides.scale;
    const minH = cellH / strides.scale;
    const maxW =
      (roomCols * cellW + (roomCols - 1) * strides.gapX) / strides.scale;
    const maxH =
      (roomRows * cellH + (roomRows - 1) * strides.gapY) / strides.scale;

    const handleMove = (moveEvent: PointerEvent) => {
      // n cells occupy n·cell + (n-1)·gap, so n = (extent + gap) / stride.
      const wantW = Math.round(
        (moveEvent.clientX - rect.left + strides.gapX) / strides.strideX,
      );
      const wantH = Math.round(
        (moveEvent.clientY - rect.top + strides.gapY) / strides.strideY,
      );
      const candidate: GridPlacement = {
        x: block.x,
        y: block.y,
        w: clamp(wantW, 1, roomCols),
        h: clamp(wantH, 1, roomRows),
      };
      latest = candidate;
      latestValid = placementIsFree(blocks, candidate, block.key, columns, rows);
      setActive({
        key: block.key,
        mode: "resize",
        placement: candidate,
        valid: latestValid,
        offset: { x: 0, y: 0 },
        // The box follows the cursor; the ghost shows where it will snap.
        size: {
          w: clamp((moveEvent.clientX - rect.left) / strides.scale, minW, maxW),
          h: clamp((moveEvent.clientY - rect.top) / strides.scale, minH, maxH),
        },
      });
    };

    const handleUp = () => {
      endGesture(handleMove, handleUp);
      if (!latestValid) return;
      if (latest.w !== block.w || latest.h !== block.h) {
        onResize?.(block.key, latest.w, latest.h);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    cleanupRef.current = () => endGesture(handleMove, handleUp);
  }

  /** Arrows move the focused block; with Shift they resize it. This is the
   *  whole keyboard story for placement, so it must stay in step with drag. */
  function onCellKeyDown(
    event: React.KeyboardEvent<HTMLLIElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive) return;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();

    const candidate = clampToCanvas(
      event.shiftKey
        ? {
            x: block.x,
            y: block.y,
            w: Math.max(1, block.w + delta[0]),
            h: Math.max(1, block.h + delta[1]),
          }
        : {
            x: block.x + delta[0],
            y: block.y + delta[1],
            w: block.w,
            h: block.h,
          },
      columns,
      rows,
    );
    if (!placementIsFree(blocks, candidate, block.key, columns, rows)) return;
    if (event.shiftKey) onResize?.(block.key, candidate.w, candidate.h);
    else onMove?.(block.key, candidate.x, candidate.y);
  }

  // Free cells, drawn so the board reads as a board (and as insert targets).
  const emptyCells = useMemo(() => {
    if (!showEmptyCells || !editable) return [];
    const taken = new Set<string>();
    for (const block of view.blocks) {
      for (let y = block.y; y < block.y + block.h; y += 1) {
        for (let x = block.x; x < block.x + block.w; x += 1) {
          taken.add(`${x},${y}`);
        }
      }
    }
    const cells: { x: number; y: number }[] = [];
    for (let y = 0; y < view.rows; y += 1) {
      for (let x = 0; x < renderColumns; x += 1) {
        if (!taken.has(`${x},${y}`)) cells.push({ x, y });
      }
    }
    return cells;
  }, [showEmptyCells, editable, view.blocks, view.rows, renderColumns]);

  return (
    <div ref={containerRef} className={cn(GRID_CONTAINER_CLASS, className)}>
      <ul
        ref={gridRef}
        aria-label={ariaLabel}
        className={cn(GRID_ROOT_CLASS, "m-0 list-none p-0")}
        style={rootStyle}
      >
        {/* Ghost: the cells the tile will occupy once the gesture ends. */}
        {active && (
          <li
            aria-hidden="true"
            style={{
              ...placementStyle(active.placement),
              ...cellStyle?.(active.placement),
            }}
            className={cn(
              "pointer-events-none border-2 border-dashed",
              active.valid
                ? "border-ring bg-accent/40"
                : "border-destructive bg-destructive/10",
              GRID_CELL_RADIUS_CLASS,
              cellClassName,
            )}
          />
        )}

        {view.blocks.map((block) => {
          const gesture = active?.key === block.key ? active : null;
          const moving = gesture?.mode === "move";
          const resizing = gesture?.mode === "resize";
          // A tile under either gesture keeps its committed cell, so the
          // layout underneath never shifts while the cursor works on it.
          const placement: GridPlacement = {
            x: block.x,
            y: block.y,
            w: block.w,
            h: block.h,
          };
          const label = getBlockLabel?.(block);
          return (
            <li
              key={block.key}
              data-grid-cell=""
              onPointerDown={
                interactive ? (event) => startMove(event, block) : undefined
              }
              onKeyDown={
                interactive ? (event) => onCellKeyDown(event, block) : undefined
              }
              // Images and links are natively draggable; that gesture would
              // hijack the pointer drag and show a not-allowed cursor.
              onDragStart={(event) => event.preventDefault()}
              style={{
                ...placementStyle(placement),
                ...cellStyle?.(placement),
                ...(moving
                  ? {
                      transform: `translate(${gesture.offset.x}px, ${gesture.offset.y}px)`,
                      willChange: "transform",
                    }
                  : {}),
                // Stretch past the grid area while resizing; the cell it
                // will settle into is the ghost underneath.
                ...(resizing && gesture.size
                  ? { width: gesture.size.w, height: gesture.size.h }
                  : {}),
              }}
              className={cn(
                "group relative overflow-hidden",
                GRID_CELL_RADIUS_CLASS,
                cellClassName,
                interactive && "cursor-grab active:cursor-grabbing",
                // Lifted off the board while the cursor is working on it.
                (moving || resizing) && "z-30 shadow-lg",
                gesture &&
                  cn(
                    "z-10 ring-2 ring-inset",
                    gesture.valid ? "ring-ring" : "ring-destructive",
                  ),
              )}
            >
              {renderBlock(block, {
                editable,
                isDragging: gesture?.mode === "move",
                isResizing: gesture?.mode === "resize",
                placement,
              })}

              {/* Corner resize handle: drag to span more cells, arrows (with
                  Shift, on the tile) do the same from the keyboard. */}
              {interactive && (
                <button
                  type="button"
                  aria-label={label ? `Resize ${label}` : "Resize block"}
                  onPointerDown={(event) => startResize(event, block)}
                  className={cn(
                    HANDLE_CLASS,
                    "bottom-1 right-1 cursor-nwse-resize touch-none select-none",
                  )}
                >
                  <MoveDiagonal2
                    className="size-3.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              )}
            </li>
          );
        })}

        {/* Free cells. Clickable when the consumer wants insert-here. */}
        {emptyCells.map((cell) =>
          onEmptyCellClick && interactive ? (
            <li key={`empty-${cell.x}-${cell.y}`} style={placementStyle({ ...cell, w: 1, h: 1 })}>
              <button
                type="button"
                onClick={() => onEmptyCellClick(cell.x, cell.y)}
                aria-label={`Add a block at column ${cell.x + 1}, row ${cell.y + 1}`}
                style={cellStyle?.({ ...cell, w: 1, h: 1 })}
                className={cn(
                  "size-full border border-dashed border-border bg-background/40 transition-colors duration-180 ease-in-out hover:border-foreground/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                  GRID_CELL_RADIUS_CLASS,
                  cellClassName,
                )}
              />
            </li>
          ) : (
            <li
              key={`empty-${cell.x}-${cell.y}`}
              aria-hidden="true"
              style={{
                ...placementStyle({ ...cell, w: 1, h: 1 }),
                ...cellStyle?.({ ...cell, w: 1, h: 1 }),
              }}
              className={cn(
                "pointer-events-none border border-dashed border-border bg-background/40",
                GRID_CELL_RADIUS_CLASS,
                cellClassName,
              )}
            />
          ),
        )}
      </ul>
    </div>
  );
}
