"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveDiagonal2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  orientedSpan,
  placementForFootprint,
  rotatedFootprint,
} from "@/lib/geometry/rotated-box";
import {
  ROTATION_SNAP_STEP,
  angleFromCenter,
  normalizeAngle,
  snapAngle,
} from "./rotationMath";
import {
  EDGE_GRAB_PX,
  GESTURE_Z,
  GRID_CELL_RADIUS_CLASS,
  GRID_COLUMNS_DEFAULT,
  GRID_CONTAINER_CLASS,
  GRID_ROOT_CLASS,
  GRID_ROWS_DEFAULT,
  blockFootprint,
  clampToCanvas,
  columnsThatFit,
  edgeCursor,
  edgesUnderPointer,
  layerZIndex,
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
 * A live drag, resize or rotate, previewed before it is committed.
 *
 * The tile always keeps its committed cell in the layout and is drawn
 * off-grid: MOVING translates it by `offset`, RESIZING stretches it to
 * `size` (both in unscaled px, so they track the cursor at any zoom),
 * ROTATING spins it about its own centre. `placement` is the cell it would
 * snap into, drawn as a ghost underneath. Snapping the tile itself would make
 * it jump cell to cell, which reads as laggy rather than direct.
 */
type ActiveGesture = {
  key: string;
  mode: "move" | "resize" | "rotate";
};

/**
 * The live gesture, held in a REF and written to the DOM once per frame.
 * Routing it through React state instead meant one re-render of every tile
 * per pointermove, which no amount of memoisation makes free.
 */
type GesturePreview = ActiveGesture & {
  placement: GridPlacement;
  /** The cells that placement will COVER, tilt included. What the ghost draws,
   *  and the reason a rotate has a ghost at all: turning a block changes which
   *  cells it lies across even though its placement never moves. */
  footprint: GridPlacement;
  valid: boolean;
  offset: { x: number; y: number };
  size?: { w: number; h: number };
  /** Rotate mode only: the angle the tile is being spun to. */
  rotation?: number;
};

/**
 * A cell's UNROTATED box in screen pixels, derived from the grid's own rect
 * and the cell pitch rather than measured off the element.
 *
 * getBoundingClientRect on a tilted cell returns its axis-aligned bounding
 * box, which is neither the cell's size nor its corners, so every gesture that
 * anchors to an edge would drift the moment a tile was rotated. Deriving it is
 * also exact mid-gesture, where the element itself is being stretched and
 * translated and would only be measuring the preview.
 */
function cellBox(
  strides: {
    rect: DOMRect;
    gapX: number;
    gapY: number;
    strideX: number;
    strideY: number;
  },
  placement: GridPlacement,
) {
  const cellW = strides.strideX - strides.gapX;
  const cellH = strides.strideY - strides.gapY;
  const left = strides.rect.left + placement.x * strides.strideX;
  const top = strides.rect.top + placement.y * strides.strideY;
  const width = placement.w * cellW + (placement.w - 1) * strides.gapX;
  const height = placement.h * cellH + (placement.h - 1) * strides.gapY;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The imperative box to give a cell so that it PAINTS on `painted`.
 *
 * A gesture works in the space the seller sees, and for a turned block that is
 * not the space the element lives in: a cell stood on its end paints its
 * height across. So the element is sized the other way round and centred on
 * the painted box's centre, which is the point CSS turns it about, and the
 * turn puts it exactly where the hand is.
 *
 * Unscaled px out, because the element sits inside a stage the canvas may have
 * zoomed while `painted` is measured on screen.
 */
function previewBox(
  painted: { left: number; top: number; right: number; bottom: number },
  cell: { left: number; top: number },
  degrees: number,
  scale: number,
): { offset: { x: number; y: number }; size: { w: number; h: number } } {
  const element = orientedSpan(
    painted.right - painted.left,
    painted.bottom - painted.top,
    degrees,
  );
  const centerX = (painted.left + painted.right) / 2;
  const centerY = (painted.top + painted.bottom) / 2;
  return {
    offset: {
      x: (centerX - element.w / 2 - cell.left) / scale,
      y: (centerY - element.h / 2 - cell.top) / scale,
    },
    size: { w: element.w / scale, h: element.h / scale },
  };
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
  /**
   * Tilt a block, in degrees. OPTIONAL even in editable mode, unlike move and
   * resize: a consumer that does not offer rotation simply omits it and no
   * handle is drawn. Rotation is visual, so a grid without it is still a
   * complete grid.
   */
  onRotate?: (key: string, rotation: number) => void;
  /**
   * Let blocks share cells.
   *
   * OFF by default, because a packed listing grid where two things land on one
   * cell is a bug. ON for a design canvas, where stacking is the point: a drop
   * onto an occupied cell lands there instead of springing back, and paint
   * order (see GridBlock.z) is what decides who is on top.
   *
   * It never relaxes the OTHER rule: a block stays on the board either way.
   */
  allowOverlap?: boolean;
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
    onRotate,
    allowOverlap = false,
  } = props;

  /**
   * Where a gesture may leave a block. One predicate, so the drag, the two
   * resizes and the keyboard can never disagree about what a legal drop is.
   *
   * On a stacking board every drop lands: each gesture CLAMPS its candidate to
   * the board before asking, so there is nothing left to refuse. Rejecting
   * here instead would strand the one block that cannot satisfy the bounds at
   * all (one turned so far that its painted box is wider than the board), and
   * a block that springs back wherever it is dropped reads as broken rather
   * than as protected.
   */
  const dropIsLegal = useCallback(
    (block: GridBlock<TData>, candidate: GridPlacement, all: GridBlock<TData>[]) =>
      allowOverlap || placementIsFree(all, candidate, block.key, columns, rows),
    [allowOverlap, columns, rows],
  );

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
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  // What a settled gesture announces. Written on COMMIT only: announcing every
  // frame of a spin is worse than announcing nothing.
  const [announcement, setAnnouncement] = useState("");
  const frameRef = useRef(0);
  // Teardown for an in-flight gesture, so unmounting mid-drag detaches the
  // window listeners instead of leaking them.
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  /** Write the live preview: the tile floats/stretches/spins, the ghost marks
   *  the cells it will snap to. One rAF per frame, however fast events arrive.
   *
   *  Offsets go to `translate` and the tilt to `rotate`, the standalone
   *  transform properties, NOT to `transform`. Two reasons, and both bite: a
   *  tile's committed rotation is written by React through the same property
   *  a drag would otherwise clobber, and the individual properties compose as
   *  translate then rotate, so a drag offset lands in SCREEN space. Folded
   *  into `transform` it would be applied inside the rotation instead, and
   *  dragging a tile tilted 30 degrees would send it off at 30 degrees to the
   *  cursor. */
  const paintGesture = useCallback(() => {
    frameRef.current = 0;
    const gesture = gestureRef.current;
    if (!gesture) return;
    const cell = cellNodes.current.get(gesture.key);
    if (cell) {
      if (gesture.mode === "move") {
        cell.style.translate = `${gesture.offset.x}px ${gesture.offset.y}px`;
      } else if (gesture.mode === "rotate") {
        cell.style.rotate = `${gesture.rotation ?? 0}deg`;
      } else if (gesture.size) {
        // Resizing translates as well as stretches: a tile keeps its committed
        // cell in the layout, so growing west/north has to be drawn as "same
        // box, shifted back" or the pinned edge would visibly drift.
        cell.style.translate = `${gesture.offset.x}px ${gesture.offset.y}px`;
        cell.style.width = `${gesture.size.w}px`;
        cell.style.height = `${gesture.size.h}px`;
      }
      cell.dataset.valid = String(gesture.valid);
    }
    // The live angle, drawn beside the handle and counter-tilted so the number
    // stays the right way up however far the tile has been spun.
    const readout = readoutRef.current;
    if (readout && gesture.mode === "rotate") {
      const angle = gesture.rotation ?? 0;
      readout.textContent = `${angle}°`;
      readout.style.rotate = `${-angle}deg`;
    }
    // The ghost marks the cells the block will COVER once it lands, which for
    // a tilted block is its painted footprint rather than the cells it is
    // placed in. Showing the placement instead would promise a 1x3 landing
    // spot for a bar that arrives lying across 3x1.
    //
    // Clamped to the board only for DRAWING: a footprint may legitimately
    // start at -1 (the block itself is on the board, its corner reaches past
    // it), and a negative grid line would put the ghost in a phantom column.
    const ghost = ghostRef.current;
    if (ghost) {
      const covered = gesture.footprint;
      const left = Math.max(0, covered.x);
      const top = Math.max(0, covered.y);
      ghost.style.gridColumn = `${left + 1} / span ${Math.max(1, covered.x + covered.w - left)}`;
      ghost.style.gridRow = `${top + 1} / span ${Math.max(1, covered.y + covered.h - top)}`;
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
      cell.style.translate = "";
      // The committed tilt comes back through React's own cell style; clearing
      // the imperative one is what lets it.
      cell.style.rotate = "";
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
    // An Alt-held press belongs to the consumer's selection tools (the
    // designer walks down through stacked blocks with it). The grid owns
    // plain presses only, so a modifier can never also drag the tile.
    if (event.altKey) return;

    // A press near the cell's border resizes from that side; only the inner
    // surface starts a move. Touch keeps the corner handle instead: edge
    // strips are too thin for a finger, and a mis-grab there would resize a
    // tile the finger meant to drag.
    const strides = readStrides();
    if (!strides) return;

    if (event.pointerType !== "touch") {
      // The box the seller sees: a turned block's footprint, a level one's own
      // cell. Derived from the grid's pitch rather than measured, because a
      // turned cell reports its axis-aligned envelope and the grab zones would
      // drift further from the real edges the more it was turned.
      const edges = edgesUnderPointer(
        cellBox(strides, blockFootprint(block)),
        event.clientX,
        event.clientY,
      );
      if (edges) {
        startEdgeResize(event, block, edges);
        return;
      }
    }

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
      latestValid = dropIsLegal(block, candidate, blocks);
      gestureRef.current = {
        key: block.key,
        mode: "move",
        placement: candidate,
        footprint: rotatedFootprint(candidate, block.rotation ?? 0),
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
   * Resize by dragging the border of the box the seller can SEE: the grabbed
   * side(s) follow the cursor, the opposite sides stay pinned (resizeByEdges
   * owns that math). A press that never travels DRAG_THRESHOLD stays a click,
   * so selecting a tile by its edge still works. Preview painting reuses the
   * same gestureRef pipeline as the corner handle.
   *
   * The whole gesture runs in BOARD space, on the footprint. For a turned
   * block that is not the same box as its placement, so the result is
   * converted back at the end (see placementForFootprint). Reading the drag in
   * the block's own turned space instead is what made a half-turned tile grow
   * downwards when its top edge was dragged up.
   */
  function startEdgeResize(
    event: React.PointerEvent<HTMLLIElement>,
    block: GridBlock<TData>,
    edges: ResizeEdges,
  ) {
    const strides = readStrides();
    if (!strides) return;

    // The committed boxes, DERIVED from the grid rect and the pitch rather
    // than measured: the gesture mutates this element (and a turned one never
    // reported its real box in the first place), so measuring it would be the
    // preview measuring itself.
    const angle = block.rotation ?? 0;
    const originFootprint = blockFootprint(block);
    const seen = cellBox(strides, originFootprint);
    const rect = cellBox(strides, block);
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
    const boardLeft = strides.rect.left;
    const boardTop = strides.rect.top;
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
      const wanted = resizeByEdges(
        originFootprint,
        edges,
        col,
        row,
        columns,
        rows,
      );
      // Back into a placement, then held to the board: the STORED rect is what
      // has to stay on the canvas, and for a turned block it is the footprint
      // stood on its end.
      const candidate = clampToCanvas(
        placementForFootprint(wanted, angle),
        columns,
        rows,
      );
      latest = candidate;
      latestValid = dropIsLegal(block, candidate, blocks);
      // Re-derived rather than reusing `wanted`, so the ghost promises the
      // cells the block will really cover once it lands.
      const landing = rotatedFootprint(candidate, angle);

      // The live box follows the cursor in the space the seller is dragging
      // in: pinned sides keep their committed edge, dragged sides track the
      // pointer (clamped to one cell and to the board).
      const left = edges.w
        ? clamp(moveEvent.clientX, boardLeft, seen.right - cellW)
        : seen.left;
      const right = edges.e
        ? clamp(moveEvent.clientX, seen.left + cellW, boardRight)
        : seen.right;
      const top = edges.n
        ? clamp(moveEvent.clientY, boardTop, seen.bottom - cellH)
        : seen.top;
      const bottom = edges.s
        ? clamp(moveEvent.clientY, seen.top + cellH, boardBottom)
        : seen.bottom;
      gestureRef.current = {
        key: block.key,
        mode: "resize",
        placement: candidate,
        footprint: landing,
        valid: latestValid,
        ...previewBox(
          { left, top, right, bottom },
          rect,
          angle,
          strides.scale,
        ),
      };
      scheduleGesturePaint();
    };

    // KNOWN LIMITATION on a tilted tile. The stretch now follows the tile's
    // own axes (see the local point above), but the tilt still turns about the
    // block's CENTRE, and growing the box moves that centre — so the edge
    // opposite the one being dragged drifts a little instead of staying
    // pinned. Correcting it means nudging x/y by the difference, which is a
    // fraction of a cell and therefore unstorable while placements are whole
    // cells. It lands with free placement, where fractions become legal.
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
    if (!strides) return;

    // The committed boxes, DERIVED rather than measured, for the same two
    // reasons as startEdgeResize: the gesture mutates this element, and a
    // turned cell's bounding rect was never its box to begin with. `seen` is
    // what the seller is dragging, `rect` is what the painter writes to.
    const angle = block.rotation ?? 0;
    const anchor = blockFootprint(block);
    const seen = cellBox(strides, anchor);
    const rect = cellBox(strides, block);
    let latest: GridPlacement = { x: block.x, y: block.y, w: block.w, h: block.h };
    let latestValid = true;
    setDragCursorLock(true);
    // One render, up front: mounts the ghost and lifts the tile.
    setActive({ key: block.key, mode: "resize" });

    /**
     * The top-left CELL of the box on screen is the anchor and always stays
     * part of the result; the block spans from it to whichever cell the cursor
     * is over. Drag right/down and that is the familiar grow. Drag past the
     * anchor and the span simply lands on the other side of it, so one handle
     * stretches up and left without a second control to aim for.
     *
     * Everything here is SCREEN px (strides already are), converted to
     * unscaled px only when handed to the painter.
     */
    const cellW = strides.strideX - strides.gapX;
    const cellH = strides.strideY - strides.gapY;
    const boardLeft = strides.rect.left;
    const boardTop = strides.rect.top;
    const anchorCellRight = seen.left + cellW;
    const anchorCellBottom = seen.top + cellH;
    const spanPxX = (n: number) => n * cellW + (n - 1) * strides.gapX;
    const spanPxY = (n: number) => n * cellH + (n - 1) * strides.gapY;

    const handleMove = (moveEvent: PointerEvent) => {
      // Which cell is under the cursor, in board coordinates. Read straight
      // from the pointer: the handle is dragged in the space the block is
      // SEEN in, and the turn is undone once at the end rather than being
      // carried through the whole gesture.
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
      const candidate = clampToCanvas(
        placementForFootprint(
          {
            x: Math.min(anchor.x, col),
            y: Math.min(anchor.y, row),
            w: Math.abs(col - anchor.x) + 1,
            h: Math.abs(row - anchor.y) + 1,
          },
          angle,
        ),
        columns,
        rows,
      );
      latest = candidate;
      latestValid = dropIsLegal(block, candidate, blocks);

      // The box follows the cursor; the ghost shows where it will snap. Once
      // flipped, the anchor CELL's far edge is what stays still.
      const flippedX = col < anchor.x;
      const flippedY = row < anchor.y;
      const sizeW = clamp(
        flippedX ? anchorCellRight - moveEvent.clientX : moveEvent.clientX - seen.left,
        cellW,
        spanPxX(flippedX ? anchor.x + 1 : columns - anchor.x),
      );
      const sizeH = clamp(
        flippedY ? anchorCellBottom - moveEvent.clientY : moveEvent.clientY - seen.top,
        cellH,
        spanPxY(flippedY ? anchor.y + 1 : rows - anchor.y),
      );
      const left = flippedX ? anchorCellRight - sizeW : seen.left;
      const top = flippedY ? anchorCellBottom - sizeH : seen.top;
      gestureRef.current = {
        key: block.key,
        mode: "resize",
        placement: candidate,
        footprint: rotatedFootprint(candidate, angle),
        valid: latestValid,
        ...previewBox(
          { left, top, right: left + sizeW, bottom: top + sizeH },
          rect,
          angle,
          strides.scale,
        ),
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
   * Spin a block about its own centre by dragging its rotate handle.
   *
   * The centre is derived from the grid rect and the pitch, never measured off
   * the cell: the cell is being rotated as the drag runs, and a tilted
   * element's bounding rect is its envelope rather than its box.
   *
   * Shift snaps to ROTATION_SNAP_STEP, which is the detent every design tool
   * shares. The angle is read as a bearing from the centre, so the tile tracks
   * the wrist rather than the pointer's distance.
   *
   * A spin changes WHICH WAY ROUND the block's cells lie (a 1x3 bar covers
   * 3x1 once it is stood on its side), so the ghost tracks that. It never
   * changes how many cells it takes and never moves it: rotating is not
   * resizing and it is not dragging, and a control that quietly did either
   * would be the one thing a seller cannot undo by turning it back.
   */
  function startRotate(
    event: React.PointerEvent<HTMLButtonElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive || !onRotate || event.button !== 0) return;
    // Never let a rotate also start a move.
    event.preventDefault();
    event.stopPropagation();
    const strides = readStrides();
    if (!strides) return;

    const box = cellBox(strides, block);
    const center = { x: box.centerX, y: box.centerY };
    const origin = block.rotation ?? 0;
    const grabbedAt = angleFromCenter(center, {
      x: event.clientX,
      y: event.clientY,
    });
    const placed: GridPlacement = {
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
    };
    let latest = origin;
    setDragCursorLock(true);
    // One render, up front: mounts the readout and marks the tile as active.
    setActive({ key: block.key, mode: "rotate" });

    const handleMove = (moveEvent: PointerEvent) => {
      const swept =
        origin +
        angleFromCenter(center, { x: moveEvent.clientX, y: moveEvent.clientY }) -
        grabbedAt;
      latest = normalizeAngle(
        moveEvent.shiftKey ? snapAngle(swept, ROTATION_SNAP_STEP) : swept,
      );
      gestureRef.current = {
        key: block.key,
        mode: "rotate",
        // The block stays exactly where it is. Only the cells it lies ACROSS
        // change, which is what the ghost underneath shows.
        placement: placed,
        footprint: rotatedFootprint(placed, latest),
        valid: true,
        offset: { x: 0, y: 0 },
        rotation: latest,
      };
      scheduleGesturePaint();
    };

    const handleUp = () => {
      endGesture(handleMove, handleUp);
      if (latest === origin) return;
      onRotate(block.key, latest);
      setAnnouncement(`${getBlockLabel?.(block) ?? "Block"} rotated to ${latest} degrees`);
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
  function updateHoverCursor(
    event: React.PointerEvent<HTMLLIElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive || event.pointerType === "touch") return;
    // Mid-gesture the drag owns the cursor; leave it alone.
    if (gestureRef.current) return;
    const cell = event.currentTarget;
    if ((event.target as HTMLElement).closest("button")) {
      cell.style.cursor = "";
      return;
    }
    const strides = readStrides();
    if (!strides) return;
    // The box the seller sees, and so the edge they think they are on. The
    // cursor needs no turning of its own: an up-down arrow on the top edge of
    // that box is exactly what dragging it does.
    const edges = edgesUnderPointer(
      cellBox(strides, blockFootprint(block)),
      event.clientX,
      event.clientY,
    );
    const next = edges ? edgeCursor(edges) : "";
    if (cell.style.cursor !== next) cell.style.cursor = next;
  }

  function resetHoverCursor(event: React.PointerEvent<HTMLLIElement>) {
    event.currentTarget.style.cursor = "";
  }

  /** Arrows move the focused block; with Shift they resize it, and with Alt
   *  they tilt it. This is the whole keyboard story for placement, so it must
   *  stay in step with drag. */
  function onCellKeyDown(
    event: React.KeyboardEvent<HTMLLIElement>,
    block: GridBlock<TData>,
  ) {
    if (!interactive) return;

    // Alt + Left/Right tilts. One degree for a nudge, a whole detent with
    // Shift, matching what the handle does with the same modifier.
    //
    // preventDefault is REQUIRED, not tidiness: Alt+Arrow is Back and Forward
    // in the browser, and an editor that navigated away mid-design would take
    // the unsaved board with it. Safe to claim because this listener is on the
    // cell, so it only ever fires with a tile focused.
    if (
      onRotate &&
      event.altKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault();
      const step = event.shiftKey ? ROTATION_SNAP_STEP : 1;
      const next = normalizeAngle(
        (block.rotation ?? 0) + (event.key === "ArrowRight" ? step : -step),
      );
      onRotate(block.key, next);
      setAnnouncement(
        `${getBlockLabel?.(block) ?? "Block"} rotated to ${next} degrees`,
      );
      return;
    }

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
    if (!dropIsLegal(block, candidate, blocks)) return;
    // An arrow into the board's edge leaves the placement exactly as it was.
    // Reporting that would mark the editor dirty and push an undo step for a
    // key press that did nothing.
    if (
      candidate.x === block.x &&
      candidate.y === block.y &&
      candidate.w === block.w &&
      candidate.h === block.h
    ) {
      return;
    }
    // Keyboard resize stays anchored at the top-left (Shift+Arrow grows or
    // shrinks the far edge). Corner dragging is where the other anchors live.
    if (event.shiftKey) onResize?.(block.key, candidate);
    else onMove?.(block.key, candidate.x, candidate.y);
  }

  // Free cells, drawn so the board reads as a board (and as insert targets).
  // A cell is taken when something PAINTS on it, so the guides disappear from
  // under a tilted block's real corners instead of from under the cells it
  // happens to be placed in.
  const emptyCells = useMemo(() => {
    if (!showEmptyCells || !editable) return [];
    const taken = new Set<string>();
    for (const block of view.blocks) {
      const covered = blockFootprint(block);
      for (let y = covered.y; y < covered.y + covered.h; y += 1) {
        for (let x = covered.x; x < covered.x + covered.w; x += 1) {
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
        {/* Ghost: the cells the tile will cover once the gesture ends. Its
            position and validity are written imperatively each frame; the
            colours come from the data-valid attribute so no re-render is
            needed to flip them.

            Drawn for a ROTATE as well, because a turned block lies across
            different cells than a level one: the ghost growing as the tile
            spins is how that stops being a surprise. */}
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
          const rotating = gesture?.mode === "rotate";
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
              // For consumers that hit-test cells from the DOM (the
              // designer's marquee selection reads these back into keys).
              data-grid-key={block.key}
              onPointerDown={
                interactive ? (event) => startMove(event, block) : undefined
              }
              onPointerMove={
                interactive
                  ? (event) => updateHoverCursor(event, block)
                  : undefined
              }
              onPointerLeave={interactive ? resetHoverCursor : undefined}
              onKeyDown={
                interactive ? (event) => onCellKeyDown(event, block) : undefined
              }
              // Images and links are natively draggable; that gesture would
              // hijack the pointer drag and show a not-allowed cursor.
              onDragStart={(event) => event.preventDefault()}
              style={{
                ...placementStyle(placement),
                // Depth, before the consumer's own cell style so a consumer
                // that needs one cell lifted for its own reasons (a tile being
                // framed) can still say so. Applied HERE, like the tilt below,
                // so every renderer of this grid stacks identically: cells are
                // siblings in one stacking context, and a consumer painting
                // depth into half of them would leave the rest at auto.
                ...(block.z !== undefined
                  ? { zIndex: layerZIndex(block.z) }
                  : {}),
                ...cellStyle?.(placement, block),
                // The tilt, as the standalone `rotate` property rather than
                // inside `transform`: the gesture painter owns `translate`,
                // and the two compose as translate-then-rotate so a drag
                // offset stays in screen space (see paintGesture).
                //
                // Applied HERE rather than by each consumer's cellStyle, so
                // every renderer of this grid tilts identically and none of
                // them can forget to.
                ...(block.rotation ? { rotate: `${block.rotation}deg` } : {}),
                // The offset / size / angle of a tile under gesture is written
                // imperatively, so it is deliberately absent here. The hint
                // names `translate` and `rotate` because those are the
                // properties actually being animated (see paintGesture).
                ...(gesture ? { willChange: "translate, rotate" } : {}),
                // Lifted clear of every block on the board while the cursor is
                // carrying or stretching it, which is why the band is a number
                // from gridConstants rather than a `z-30` class: a class would
                // only clear the first thirty blocks of a layered board. A
                // rotate keeps its own depth, since the tile is turning on the
                // spot rather than being carried anywhere.
                ...(moving || resizing ? { zIndex: GESTURE_Z } : {}),
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
                // The lift itself is a z-index from the shared band, written
                // inline above; this is only what it looks like.
                (moving || resizing) && "shadow-lg",
                gesture &&
                  cn(
                    "ring-2 ring-inset",
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

              {/* Rotate handle, mirroring the resize handle across the tile so
                  the two are never confused for one another. Inside the cell
                  rather than floating outside it, so a 1x1 tile at the board's
                  edge still has something to reach for.

                  role=slider carries the angle to assistive tech, which is the
                  accessible pattern for a draggable handle holding a value;
                  Alt+Arrows on the tile itself is the keyboard route. */}
              {interactive && onRotate && (
                <button
                  type="button"
                  role="slider"
                  aria-label={label ? `Rotate ${label}` : "Rotate block"}
                  aria-valuemin={-180}
                  aria-valuemax={180}
                  aria-valuenow={block.rotation ?? 0}
                  aria-valuetext={`${block.rotation ?? 0} degrees`}
                  onPointerDown={(event) => startRotate(event, block)}
                  // The fastest undo of a spin that went wrong.
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (block.rotation !== undefined) onRotate(block.key, 0);
                  }}
                  className={cn(
                    HANDLE_CLASS,
                    "bottom-1 left-1 cursor-grab touch-none select-none active:cursor-grabbing",
                  )}
                >
                  <RotateCw
                    className="size-3.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              )}

              {/* Live angle, written imperatively during the spin so a 60Hz
                  drag costs no renders, and counter-tilted so the number stays
                  the right way up however far the tile has turned. */}
              {rotating && (
                <span
                  ref={readoutRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-7 left-1 z-20 rounded-sm border border-border bg-background/95 px-1.5 py-0.5 font-inter text-xs text-foreground shadow-xs"
                >
                  {/* Seeded with the angle the spin STARTED at, so a press
                      that has not travelled yet shows a number rather than an
                      empty chip. The painter takes over from the first move. */}
                  {`${block.rotation ?? 0}°`}
                </span>
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
                // Marks a FREE-cell control: a consumer's drag gesture (the
                // designer's marquee) may start here, unlike real controls.
                data-grid-empty=""
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

      {/* What a settled gesture leaves behind, for anyone not watching the
          board. Updated on COMMIT only: a spin announced frame by frame is
          noise, and noise is worse than silence. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
