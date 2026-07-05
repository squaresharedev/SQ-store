import { useCallback, useEffect, useRef, useState } from "react";
import {
  GRID_SIZES,
  MAX_COL_SPAN,
  MAX_ROW_SPAN,
  SIZE_LABELS,
  SIZE_SPANS,
  snapToSize,
  type GridSize,
} from "./gridConstants";

// RESIZE LOGIC ONLY. Pointer + keyboard handling for a corner resize handle,
// snapping to the allowed size enum and emitting the new size. Deliberately
// decoupled from Grid rendering: it measures the cell it is told about and
// reports state; it draws nothing and knows nothing about product data.

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Read the grid's gap (px) off the cell's parent so drag math matches layout. */
function readGaps(cell: HTMLElement): { gapX: number; gapY: number } {
  const parent = cell.parentElement;
  if (!parent) return { gapX: 0, gapY: 0 };
  const style = getComputedStyle(parent);
  return {
    gapX: Number.parseFloat(style.columnGap) || 0,
    gapY: Number.parseFloat(style.rowGap) || 0,
  };
}

export interface UseResizableOptions {
  /** The block's committed size (the source of truth while idle). */
  size: GridSize;
  /** Current column count, so a drag can't grow past the track count. */
  columns: number;
  /** Commit callback, fired on pointer release / key press with a NEW size. */
  onResize: (size: GridSize) => void;
  /** Accessible name for the handle, e.g. the block's title. */
  label?: string;
  disabled?: boolean;
}

/** Props to spread on the resize handle button (`<button {...handleProps} />`). */
export interface ResizeHandleProps {
  role: "slider";
  tabIndex: number;
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  "aria-valuetext": string;
  "aria-disabled"?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export interface UseResizableResult {
  /** Render the cell at THIS size — the live preview while dragging. */
  previewSize: GridSize;
  isResizing: boolean;
  /** Attach to the resizable cell element so the drag can measure it. */
  setCellRef: (node: HTMLElement | null) => void;
  handleProps: ResizeHandleProps;
}

export function useResizable({
  size,
  columns,
  onResize,
  label = "block",
  disabled = false,
}: UseResizableOptions): UseResizableResult {
  const cellRef = useRef<HTMLElement | null>(null);
  const [dragSize, setDragSize] = useState<GridSize | null>(null);
  // Holds the active drag's listener-teardown fn, so an unmount mid-resize can
  // detach the window listeners instead of leaking them.
  const cleanupRef = useRef<(() => void) | null>(null);

  const setCellRef = useCallback((node: HTMLElement | null) => {
    cellRef.current = node;
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      // Only the primary (usually left) button starts a resize.
      if (disabled || event.button !== 0) return;
      const cell = cellRef.current;
      if (!cell) return;
      // Never let the pointer-down bubble into a drag-to-reorder sensor or
      // start a text selection.
      event.preventDefault();
      event.stopPropagation();

      const rect = cell.getBoundingClientRect();
      const { gapX, gapY } = readGaps(cell);
      const { colSpan, rowSpan } = SIZE_SPANS[size];
      // Back out the per-cell pixel size from the block's current rendered box.
      const cellW = (rect.width - (colSpan - 1) * gapX) / colSpan;
      const cellH = (rect.height - (rowSpan - 1) * gapY) / rowSpan;
      const strideX = cellW + gapX;
      const strideY = cellH + gapY;
      const maxCols = Math.min(columns, MAX_COL_SPAN);

      setDragSize(size);
      let latest = size;

      const onMove = (moveEvent: PointerEvent) => {
        // n cells occupy n·cell + (n-1)·gap, so n = (extent + gap) / stride.
        const wantCols =
          strideX > 0
            ? clamp(Math.round((moveEvent.clientX - rect.left + gapX) / strideX), 1, maxCols)
            : 1;
        const wantRows =
          strideY > 0
            ? clamp(Math.round((moveEvent.clientY - rect.top + gapY) / strideY), 1, MAX_ROW_SPAN)
            : 1;
        const next = snapToSize(wantCols, wantRows);
        latest = next;
        setDragSize(next);
      };

      const teardown = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        cleanupRef.current = null;
      };

      const onUp = () => {
        teardown();
        setDragSize(null);
        if (latest !== size) onResize(latest);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      cleanupRef.current = teardown;
    },
    [columns, disabled, onResize, size],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      // Arrows resize in 2D: left/right change width, up/down change height.
      const { colSpan, rowSpan } = SIZE_SPANS[size];
      const maxCols = Math.min(columns, MAX_COL_SPAN);
      let c = colSpan;
      let r = rowSpan;
      switch (event.key) {
        case "ArrowRight":
          c = Math.min(colSpan + 1, maxCols);
          break;
        case "ArrowLeft":
          c = Math.max(colSpan - 1, 1);
          break;
        case "ArrowDown":
          r = Math.min(rowSpan + 1, MAX_ROW_SPAN);
          break;
        case "ArrowUp":
          r = Math.max(rowSpan - 1, 1);
          break;
        default:
          return;
      }
      // Stop the arrow keys from also driving the dnd keyboard sensor / scroll.
      event.preventDefault();
      event.stopPropagation();
      const next = snapToSize(c, r);
      if (next !== size) onResize(next);
    },
    [columns, disabled, onResize, size],
  );

  const previewSize = dragSize ?? size;
  // ARIA tracks the LIVE preview so the slider announces the size under the
  // pointer/arrow keys, matching the visual span.
  const valueIndex = GRID_SIZES.indexOf(previewSize);

  return {
    previewSize,
    isResizing: dragSize !== null,
    setCellRef,
    handleProps: {
      role: "slider",
      tabIndex: disabled ? -1 : 0,
      "aria-label": `Resize ${label}`,
      "aria-valuemin": 1,
      "aria-valuemax": GRID_SIZES.length,
      "aria-valuenow": valueIndex + 1,
      "aria-valuetext": SIZE_LABELS[previewSize],
      "aria-disabled": disabled || undefined,
      onPointerDown,
      onKeyDown,
    },
  };
}
