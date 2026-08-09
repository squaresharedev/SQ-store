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
  edgeCursor,
  edgesUnderPointer,
  placementIsFree,
  reflowBlocks,
  resizeByEdges,
  type GridBlock,
  type GridPlacement,
  type RenderGridBlock,
  type ResizeEdges,
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
//
// `responsive={false}` turns that off, for consumers that scale the whole
// board down instead of reflowing it (the storefront preview). Reflow exists
// to keep cells legible at small sizes; a caller that shrinks the board is
// deliberately trading legibility for fidelity, and a reflowed miniature would
// show a layout the storefront does not have.

/** Pointer travel (px) before a press on a cell becomes a drag rather than a
 *  click. Matches the threshold the tile's own click guard uses. */
const DRAG_THRESHOLD = 4;

/** Handle chrome — token-only. Hidden until hover/focus on fine pointers,
 *  always visible on coarse (touch) pointers, which have no hover. */
const HANDLE_CLASS = cn(
  "absolute z-20 inline-flex size-6 items-center justify-center rounded-sm border border-border",
  "bg-background/95 text-muted-foreground shadow-xs transition-opacity duration-base ease-standard",
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
};

/**
 * The live gesture, held in a REF and written to the DOM once per frame.
 * Routing it through React state instead meant one re-render of every tile
 * per pointermove, which no amount of memoisation makes free.
 */
type GesturePreview = ActiveGesture & {
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
  /** Reflow into fewer columns when the container is too narrow for legible
   *  cells. Off for boards that are scaled down as a whole rather than
   *  re-laid-out, where the designed coordinates ARE the thing being shown. */
  responsive?: boolean;
  /** Accessible name for the grid list. */
  ariaLabel?: string;
  /** Accessible name per block, for its drag/resize affordances. */
  getBlockLabel?: (block: GridBlock<TData>) => string;
  className?: string;
  /** Extra classes for each cell surface (e.g. a theme radius). */
  cellClassName?: string;
  /** Inline styles per cell, for values classes can't express (e.g. a numeric
   *  border-radius that scales with the block's span). Occupied cells also
   *  receive their block, so a consumer can style cells per block (empty
   *  cells and the drag ghost call it with the placement alone). */
  cellStyle?: (
    placement: GridPlacement,
    block?: GridBlock<TData>,
  ) => React.CSSProperties;
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
      /** The WHOLE placement: dragging a west/north corner moves the origin as
       *  well as the extent, so w/h alone cannot describe the result. */
      onResize: (key: string, placement: GridPlacement) => void;
    });

export function Grid<TData>(props: GridProps<TData>) {
  const {
    blocks,
    renderBlock,
    editable = false,
    columns = GRID_COLUMNS_DEFAULT,
    rows = GRID_ROWS_DEFAULT,
    responsive = true,
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
  // Which block is under a gesture — set ONCE when it starts, cleared when it
  // ends. The moment-to-moment preview lives in gestureRef and is painted
  // straight to the DOM, so a drag costs two renders rather than one per
  // pointer event.
  const [active, setActive] = useState<ActiveGesture | null>(null);
  const gestureRef = useRef<GesturePreview | null>(null);
  const cellNodes = useRef(new Map<string, HTMLLIElement>());
  const ghostRef = useRef<HTMLLIElement | null>(null);
  const frameRef = useRef(0);
  // Teardown for an in-flight gesture, so unmounting mid-drag detaches the
  // window listeners instead of leaking them.
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  /** Write the live preview: the tile floats/stretches, the ghost marks the
   *  cells it will snap to. One rAF per frame, however fast events arrive. */
  const paintGesture = useCallback(() => {
    frameRef.current = 0;
    const gesture = gestureRef.current;
    if (!gesture) return;
    const cell = cellNodes.current.get(gesture.key);
    if (cell) {
      if (gesture.mode === "move") {
        cell.style.transform = `translate3d(${gesture.offset.x}px, ${gesture.offset.y}px, 0)`;
      } else if (gesture.size) {
        // Resizing translates as well as stretches: a tile keeps its committed
        // cell in the layout, so growing west/north has to be drawn as "same
        // box, shifted back" or the pinned edge would visibly drift.
        cell.style.transform = `translate3d(${gesture.offset.x}px, ${gesture.offset.y}px, 0)`;
        cell.style.width = `${gesture.size.w}px`;
        cell.style.height = `${gesture.size.h}px`;
      }
      cell.dataset.valid = String(gesture.valid);
    }
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.style.gridColumn = `${gesture.placement.x + 1} / span ${gesture.placement.w}`;
      ghost.style.gridRow = `${gesture.placement.y + 1} / span ${gesture.placement.h}`;
      ghost.dataset.valid = String(gesture.valid);
    }
  }, []);

  const scheduleGesturePaint = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(paintGesture);
  }, [paintGesture]);

  /** Hand the cell back to the layout once the gesture is over. */
  const clearGestureStyles = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const gesture = gestureRef.current;
    const cell = gesture ? cellNodes.current.get(gesture.key) : null;
    if (cell) {
      cell.style.transform = "";
      cell.style.width = "";
      cell.style.height = "";
      delete cell.dataset.valid;
    }
    gestureRef.current = null;
  }, []);

  // Measure LAYOUT width (clientWidth ignores any zoom transform on an
  // ancestor), so zooming never changes which responsive tier we are in.
  useEffect(() => {
    const container = containerRef.current;
    // A non-responsive grid never consults its width, so it also never pays
    // for the observer — which matters on a page of preview cards.
    if (!container || !responsive) return;
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
  }, [responsive]);

  const renderColumns =
    responsive && metrics.width > 0
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
      clearGestureStyles();
      setActive(null);
    },
    [clearGestureStyles],
  );

  function startMove(
    event: React.PointerEvent<HTMLLIElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive || event.button !== 0) return;
    // Presses on the cell's own controls (remove, resize) keep their behavior.
    if ((event.target as HTMLElement).closest("button")) return;

    // A press near the cell's border resizes from that side; only the inner
    // surface starts a move. Touch keeps the corner handle instead: edge
    // strips are too thin for a finger, and a mis-grab there would resize a
    // tile the finger meant to drag.
    if (event.pointerType !== "touch") {
      const edges = edgesUnderPointer(
        event.currentTarget.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      if (edges) {
        startEdgeResize(event, block, edges);
        return;
      }
    }
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
        // The only render this gesture causes: it mounts the ghost and marks
        // the tile as lifted.
        setActive({ key: block.key, mode: "move" });
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
      gestureRef.current = {
        key: block.key,
        mode: "move",
        placement: candidate,
        valid: latestValid,
        // Unscaled, so the tile tracks the cursor 1:1 at any zoom.
        offset: { x: dx / strides.scale, y: dy / strides.scale },
      };
      scheduleGesturePaint();
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

  /**
   * Resize by dragging a cell's own border: the grabbed side(s) follow the
   * cursor, the opposite sides stay pinned (resizeByEdges owns that math).
   * A press that never travels DRAG_THRESHOLD stays a click, so selecting a
   * tile by its edge still works. Preview painting reuses the same
   * gestureRef pipeline as the corner handle.
   */
  function startEdgeResize(
    event: React.PointerEvent<HTMLLIElement>,
    block: GridBlock<TData>,
    edges: ResizeEdges,
  ) {
    const strides = readStrides();
    const cell = event.currentTarget;
    if (!strides) return;

    // Captured ONCE (see startResize): the gesture mutates this element's
    // box, so a fresh rect mid-drag would measure the preview.
    const rect = cell.getBoundingClientRect();
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

    const cellW = strides.strideX - strides.gapX;
    const cellH = strides.strideY - strides.gapY;
    const boardLeft = rect.left - block.x * strides.strideX;
    const boardTop = rect.top - block.y * strides.strideY;
    const boardRight = boardLeft + columns * cellW + (columns - 1) * strides.gapX;
    const boardBottom = boardTop + rows * cellH + (rows - 1) * strides.gapY;

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      // A short press is a click (select); only real travel starts the resize.
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        setDragCursorLock(true);
        setActive({ key: block.key, mode: "resize" });
      }

      const col = clamp(
        Math.floor((moveEvent.clientX - boardLeft) / strides.strideX),
        0,
        columns - 1,
      );
      const row = clamp(
        Math.floor((moveEvent.clientY - boardTop) / strides.strideY),
        0,
        rows - 1,
      );
      const candidate = resizeByEdges(origin, edges, col, row, columns, rows);
      latest = candidate;
      latestValid = placementIsFree(blocks, candidate, block.key, columns, rows);

      // The preview box in SCREEN px: pinned sides keep the committed edge,
      // dragged sides follow the cursor (clamped to one cell and the board).
      const left = edges.w
        ? clamp(moveEvent.clientX, boardLeft, rect.right - cellW)
        : rect.left;
      const right = edges.e
        ? clamp(moveEvent.clientX, rect.left + cellW, boardRight)
        : rect.right;
      const top = edges.n
        ? clamp(moveEvent.clientY, boardTop, rect.bottom - cellH)
        : rect.top;
      const bottom = edges.s
        ? clamp(moveEvent.clientY, rect.top + cellH, boardBottom)
        : rect.bottom;
      gestureRef.current = {
        key: block.key,
        mode: "resize",
        placement: candidate,
        valid: latestValid,
        // The tile keeps its committed cell in the layout, so a west/north
        // stretch is drawn as "same box, shifted back" (unscaled px).
        offset: {
          x: (left - rect.left) / strides.scale,
          y: (top - rect.top) / strides.scale,
        },
        size: { w: (right - left) / strides.scale, h: (bottom - top) / strides.scale },
      };
      scheduleGesturePaint();
    };

    const handleUp = () => {
      endGesture(handleMove, handleUp);
      if (!dragging || !latestValid) return;
      if (
        latest.x !== origin.x ||
        latest.y !== origin.y ||
        latest.w !== origin.w ||
        latest.h !== origin.h
      ) {
        onResize?.(block.key, latest);
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

    // Captured ONCE, and deliberately never re-read: the gesture mutates this
    // element's width/height/transform, so a fresh rect mid-drag would be the
    // preview measuring itself. These stay the committed box, which is what
    // the pinned edges are anchored to.
    const rect = cell.getBoundingClientRect();
    let latest: GridPlacement = { x: block.x, y: block.y, w: block.w, h: block.h };
    let latestValid = true;
    setDragCursorLock(true);
    // One render, up front: mounts the ghost and lifts the tile.
    setActive({ key: block.key, mode: "resize" });

    /**
     * The tile's own top-left CELL is the anchor and always stays part of the
     * result; the block spans from it to whichever cell the cursor is over.
     * Drag right/down and that is the familiar grow. Drag past the anchor and
     * the span simply lands on the other side of it, so one handle stretches
     * up and left without a second control to aim for.
     *
     * Everything here is SCREEN px (strides already are), converted to
     * unscaled px only when handed to the painter.
     */
    const cellW = strides.strideX - strides.gapX;
    const cellH = strides.strideY - strides.gapY;
    // The board's origin, derived from the tile's committed box and its column.
    const boardLeft = rect.left - block.x * strides.strideX;
    const boardTop = rect.top - block.y * strides.strideY;
    const anchorCellRight = rect.left + cellW;
    const anchorCellBottom = rect.top + cellH;
    const spanPxX = (n: number) => n * cellW + (n - 1) * strides.gapX;
    const spanPxY = (n: number) => n * cellH + (n - 1) * strides.gapY;

    const handleMove = (moveEvent: PointerEvent) => {
      // Which cell is under the cursor, in board coordinates.
      const col = clamp(
        Math.floor((moveEvent.clientX - boardLeft) / strides.strideX),
        0,
        columns - 1,
      );
      const row = clamp(
        Math.floor((moveEvent.clientY - boardTop) / strides.strideY),
        0,
        rows - 1,
      );
      const candidate: GridPlacement = {
        x: Math.min(block.x, col),
        y: Math.min(block.y, row),
        w: Math.abs(col - block.x) + 1,
        h: Math.abs(row - block.y) + 1,
      };
      latest = candidate;
      latestValid = placementIsFree(blocks, candidate, block.key, columns, rows);

      // The box follows the cursor; the ghost shows where it will snap. Once
      // flipped, the anchor CELL's far edge is what stays still.
      const flippedX = col < block.x;
      const flippedY = row < block.y;
      const sizeW = clamp(
        flippedX ? anchorCellRight - moveEvent.clientX : moveEvent.clientX - rect.left,
        cellW,
        spanPxX(flippedX ? block.x + 1 : columns - block.x),
      );
      const sizeH = clamp(
        flippedY ? anchorCellBottom - moveEvent.clientY : moveEvent.clientY - rect.top,
        cellH,
        spanPxY(flippedY ? block.y + 1 : rows - block.y),
      );
      gestureRef.current = {
        key: block.key,
        mode: "resize",
        placement: candidate,
        valid: latestValid,
        // A tile keeps its committed cell in the layout, so a flipped preview
        // has to be translated back by however far it now reaches.
        offset: {
          x: flippedX ? (anchorCellRight - sizeW - rect.left) / strides.scale : 0,
          y: flippedY ? (anchorCellBottom - sizeH - rect.top) / strides.scale : 0,
        },
        size: { w: sizeW / strides.scale, h: sizeH / strides.scale },
      };
      scheduleGesturePaint();
    };

    const handleUp = () => {
      endGesture(handleMove, handleUp);
      if (!latestValid) return;
      if (
        latest.x !== block.x ||
        latest.y !== block.y ||
        latest.w !== block.w ||
        latest.h !== block.h
      ) {
        onResize?.(block.key, latest);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    cleanupRef.current = () => endGesture(handleMove, handleUp);
  }

  /**
   * Hover feedback for the edge zones: a resize cursor near a border, the
   * grab cursor (from the class) on the inner surface. Written straight to
   * the node, never through state — this fires on every pointermove.
   */
  function updateHoverCursor(event: React.PointerEvent<HTMLLIElement>) {
    if (!interactive || event.pointerType === "touch") return;
    // Mid-gesture the drag owns the cursor; leave it alone.
    if (gestureRef.current) return;
    const cell = event.currentTarget;
    if ((event.target as HTMLElement).closest("button")) {
      cell.style.cursor = "";
      return;
    }
    const edges = edgesUnderPointer(
      cell.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const next = edges ? edgeCursor(edges) : "";
    if (cell.style.cursor !== next) cell.style.cursor = next;
  }

  function resetHoverCursor(event: React.PointerEvent<HTMLLIElement>) {
    event.currentTarget.style.cursor = "";
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
    // Keyboard resize stays anchored at the top-left (Shift+Arrow grows or
    // shrinks the far edge). Corner dragging is where the other anchors live.
    if (event.shiftKey) onResize?.(block.key, candidate);
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
        {/* Ghost: the cells the tile will occupy once the gesture ends. Its
            position and validity are written imperatively each frame; the
            colours come from the data-valid attribute so no re-render is
            needed to flip them. */}
        {active && (
          <li
            ref={ghostRef}
            aria-hidden="true"
            data-valid="true"
            style={cellStyle?.({ x: 0, y: 0, w: 1, h: 1 })}
            className={cn(
              "pointer-events-none border-2 border-dashed",
              "data-[valid=true]:border-ring data-[valid=true]:bg-accent/40",
              "data-[valid=false]:border-destructive data-[valid=false]:bg-destructive/10",
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
              ref={(node) => {
                // The gesture painter writes straight to these nodes.
                if (node) cellNodes.current.set(block.key, node);
                else cellNodes.current.delete(block.key);
              }}
              data-grid-cell=""
              onPointerDown={
                interactive ? (event) => startMove(event, block) : undefined
              }
              onPointerMove={interactive ? updateHoverCursor : undefined}
              onPointerLeave={interactive ? resetHoverCursor : undefined}
              onKeyDown={
                interactive ? (event) => onCellKeyDown(event, block) : undefined
              }
              // Images and links are natively draggable; that gesture would
              // hijack the pointer drag and show a not-allowed cursor.
              onDragStart={(event) => event.preventDefault()}
              style={{
                ...placementStyle(placement),
                ...cellStyle?.(placement, block),
                // The transform / size of a tile under gesture is written
                // imperatively, so it is deliberately absent here.
                ...(gesture ? { willChange: "transform" } : {}),
              }}
              className={cn(
                // NO overflow clip here: content clipping (to the corner
                // radius) is renderBlock's job, so the remove chip and the
                // resize handle can sit in the square corner of a heavily
                // rounded tile instead of being cut off by its clip.
                "group relative",
                GRID_CELL_RADIUS_CLASS,
                cellClassName,
                interactive && "cursor-grab active:cursor-grabbing",
                // Lifted off the board while the cursor is working on it.
                (moving || resizing) && "z-30 shadow-lg",
                gesture &&
                  cn(
                    "z-10 ring-2 ring-inset",
                    "data-[valid=true]:ring-ring data-[valid=false]:ring-destructive",
                  ),
              )}
            >
              {renderBlock(block, {
                editable,
                isDragging: gesture?.mode === "move",
                isResizing: gesture?.mode === "resize",
                placement,
              })}

              {/* One resize handle. Drag it ANY direction: past the tile's own
                  top-left it flips and the tile grows up / left instead.
                  Arrows (with Shift, on the tile) do the same from the
                  keyboard. */}
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
                  "size-full border border-dashed border-border bg-background/40 transition-colors duration-base ease-standard hover:border-foreground/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
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
