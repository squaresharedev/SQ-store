"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveDiagonal2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { footprintOffset, rotatedFootprint } from "@/lib/geometry/rotated-box";
import {
  ROTATION_SNAP_STEP,
  angleFromCenter,
  normalizeAngle,
  snapAngle,
  toLocalPoint,
  type Point,
} from "./rotationMath";
import {
  GESTURE_Z,
  GRID_CELL_RADIUS_CLASS,
  GRID_COLUMNS_DEFAULT,
  GRID_CONTAINER_CLASS,
  GRID_ROOT_CLASS,
  GRID_ROWS_DEFAULT,
  blockFootprint,
  boardInLocalFrame,
  clampToCanvas,
  columnsThatFit,
  edgeCursor,
  edgesUnderPointer,
  EMPTY_CELL_Z,
  keyboardResizeStep,
  layerZIndex,
  liftableChromeKeys,
  placementFromLocalBox,
  placementIsFree,
  reflowBlocks,
  resizeLocalBox,
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
 *  always visible on coarse (touch) pointers, which have no hover, and always
 *  visible while the consumer has marked the block SELECTED.
 *
 *  OUTSIDE THE TILE, hanging just under its bottom edge (see HANDLE_ROW). A
 *  handle drawn on the tile is drawn on the SELLER'S WORK: the rotate control
 *  sat exactly where a price tag or a title band goes, so the thing being
 *  designed was hidden by the thing designing it. Out here they hang off the
 *  tile without ever covering it, and they still turn with it — they are
 *  children of the cell, so a tilted tile carries its controls round with it.
 *
 *  SEAMLESS, not floating and not merely touching: a handle is meant to read
 *  as a tab growing out of the tile, not a separate pill parked near it.
 *  Three things make that read correctly rather than as a glitch:
 *
 *    - FLUSH, with a hairline of overlap (`-mt-px`) rather than sitting
 *      exactly at the edge. A subpixel gap is possible wherever a zoomed
 *      stage rounds two elements' coordinates a fraction of a pixel apart,
 *      and that sliver is dead space for the pointer — it belongs to neither
 *      this handle nor the tile, so crossing it drops `:hover` off the cell
 *      and fades the handle out from under the hand reaching for it.
 *    - NO BORDER on the edge that overlaps (`border-t-0`). A handle with a
 *      full border sitting a pixel into the tile draws TWO border lines on
 *      top of each other there — the handle's own top edge and the tile's
 *      bottom edge — which is what actually reads as an overlap: a visibly
 *      doubled, slightly misaligned line. Dropping the handle's own top
 *      border leaves only the tile's line showing through, so the seam
 *      disappears instead of doubling.
 *    - ROUNDED ONLY ON THE BOTTOM. The touching (top) corners stay square so
 *      the handle's silhouette continues the tile's own bottom edge instead
 *      of notching into it.
 *
 *  `data-block-selected` (set by the consumer on anything inside the cell) is
 *  what keeps them out once a block is being worked on. Hover alone was not
 *  enough for chrome that lives outside the tile: it is reached by leaving the
 *  tile, and a handle that starts fading the moment the hand sets off for it
 *  is a handle you chase.
 *
 *  Hidden handles take NO PRESSES. An `opacity: 0` button still hit-tests, and
 *  these hang over the neighbouring cell, which on an editable board is a free
 *  cell that inserts a block when clicked. Drawn nothing, doing nothing.
 *
 *  Gone entirely while the block has put an editing surface over itself
 *  (`data-block-overlay`, e.g. framing a photo). Such a surface covers the
 *  whole cell above these, so they were already unpressable — drawn but dead,
 *  and now drawn under that surface's own corner controls. A handle you can
 *  see and cannot use is worse than no handle. */
const HANDLE_CLASS = cn(
  "absolute z-20 inline-flex size-6 items-center justify-center",
  "rounded-b-sm rounded-t-none border border-t-0 border-border",
  "bg-background/95 text-muted-foreground transition-opacity duration-base ease-standard",
  // Same colour as the ring around the tile they belong to, so a selected
  // block and its controls read as one object rather than three.
  "group-has-[[data-block-selected]]:border-ring",
  "hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "motion-reduce:transition-none",
  "pointer-fine:pointer-events-none pointer-fine:opacity-0",
  "pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100",
  "pointer-fine:group-focus-within:pointer-events-auto pointer-fine:group-focus-within:opacity-100",
  "pointer-fine:group-has-[[data-block-selected]]:pointer-events-auto",
  "pointer-fine:group-has-[[data-block-selected]]:opacity-100",
  "group-has-[[data-block-overlay]]:hidden",
);

/** The strip the handles live in: hanging off the tile's bottom edge, flush
 *  with it (a hairline of overlap, `-mt-px`, rather than a gap — see
 *  HANDLE_CLASS for why). */
const HANDLE_ROW = "top-full -mt-px";

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

/**
 * THE HALF-CELL NUDGE THAT PUTS A TURNED TILE BACK ON THE CELLS IT CLAIMS.
 *
 * See footprintOffset: a block stood on its side is drawn about its own centre,
 * so one whose width and height differ in parity paints straddling the grid's
 * lines instead of on them. No placement can express the correction — x and y
 * are whole cells and the miss is half of one — so it is applied here, to the
 * paint. It follows the FOOTPRINT rather than the exact angle, so 85 and 91
 * degrees sit where 90 does and the tile never steps sideways as it is turned
 * through the right angle.
 *
 * As `left`/`top` rather than a translate, for two reasons. The gesture painter
 * OWNS `translate` (and blanks it when a drag ends), so a nudge written there
 * would be wiped by the first drag. And a relative offset is layout-space, i.e.
 * BEFORE the tilt — which is the space the miss is measured in; folded into
 * `transform` it would be applied inside the rotation and point the wrong way.
 *
 * Stated in the element's OWN size so nothing has to be measured: `left`'s
 * percentage resolves against the block's grid area, which is
 * `w` cells + `w - 1` gaps, so `(100% + gap) / w` is exactly one cell pitch
 * however wide the board is drawn. Same on the other axis with `h`.
 */
function snapToGridStyle(
  placement: GridPlacement,
  rotation: number,
): React.CSSProperties {
  const offset = footprintOffset(placement, rotation);
  const pitch = (cells: number, span: number) =>
    `calc((100% + var(--grid-gap, 0px)) * ${cells / span})`;
  return {
    ...(offset.x ? { left: pitch(offset.x, placement.w) } : {}),
    ...(offset.y ? { top: pitch(offset.y, placement.h) } : {}),
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

/** Cell pitch, gaps and zoom, as read off the live grid. */
type Strides = {
  rect: DOMRect;
  gapX: number;
  gapY: number;
  scale: number;
  strideX: number;
  strideY: number;
};

/**
 * The imperative box to give a cell so that it PAINTS on `box`.
 *
 * `box` is a placement in CELLS and may be fractional, since a live drag is
 * not on a cell boundary yet. The element keeps its committed grid area in the
 * layout, so the difference between the two is written as a translate and the
 * span as an explicit width and height.
 *
 * Nothing here touches the tilt: the element is turned about its own centre by
 * CSS, and a box placed where this says paints turned exactly where the
 * gesture worked out it should.
 *
 * Unscaled px out, because the element sits inside a stage the canvas may have
 * zoomed while the strides are measured on screen.
 */
function previewBox(
  box: { x: number; y: number; w: number; h: number },
  origin: GridPlacement,
  strides: Strides,
  /** The snap nudge the element is ALREADY carrying (see snapToGridStyle), in
   *  cells. Subtracted so the live box paints exactly where the gesture says,
   *  rather than half a cell out from under the hand that is dragging it. */
  snap: Point = { x: 0, y: 0 },
): { offset: { x: number; y: number }; size: { w: number; h: number } } {
  const cellW = strides.strideX - strides.gapX;
  const cellH = strides.strideY - strides.gapY;
  return {
    offset: {
      x: ((box.x - origin.x - snap.x) * strides.strideX) / strides.scale,
      y: ((box.y - origin.y - snap.y) * strides.strideY) / strides.scale,
    },
    size: {
      w: (box.w * cellW + (box.w - 1) * strides.gapX) / strides.scale,
      h: (box.h * cellH + (box.h - 1) * strides.gapY) / strides.scale,
    },
  };
}

/** A continuous placement rounded onto the board's whole cells. */
function roundPlacement(box: {
  x: number;
  y: number;
  w: number;
  h: number;
}): GridPlacement {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
  };
}

/**
 * The pointer in a block's OWN frame, in cells: un-rotated about the block's
 * centre, then divided by the cell pitch.
 *
 * The half gap is what puts the boundary between two cells in the MIDDLE of
 * the gutter rather than at the far edge of the cell before it, so rounding to
 * the nearest grid line means what the hand thinks it means.
 */
function localPointerCell(
  strides: Strides,
  center: Point,
  degrees: number,
  clientX: number,
  clientY: number,
  /** The snap nudge the tile is painted with, in SCREEN px. Taken off the
   *  pointer first, so the hand's position is read in the same frame the
   *  block's stored rect lives in (see blockPointer). */
  snap: Point = { x: 0, y: 0 },
): Point {
  const local = toLocalPoint(center, degrees, {
    x: clientX - snap.x,
    y: clientY - snap.y,
  });
  return {
    x: (local.x - strides.rect.left + strides.gapX / 2) / strides.strideX,
    y: (local.y - strides.rect.top + strides.gapY / 2) / strides.strideY,
  };
}

/**
 * The nudge a block is painted with, in SCREEN pixels.
 *
 * Everything the gestures compute — the block's box, the pointer un-rotated
 * into its frame, the placement a resize lands on — works in the STORED rect's
 * space, which is where the placement maths has to end up. The tile the hand is
 * actually on is that box shifted by this. So the pointer is brought back into
 * stored space by subtracting it (see localPointerCell and edgeGrab), and
 * nothing downstream has to know the nudge exists.
 */
function snapShift(strides: Strides, block: GridBlock<unknown>): Point {
  const offset = footprintOffset(block, block.rotation ?? 0);
  return { x: offset.x * strides.strideX, y: offset.y * strides.strideY };
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
  /**
   * The angle the tile has to be left painting at once its gesture ends.
   *
   * React writes only the style properties that CHANGED between two renders,
   * so an inline `rotate` this component blanks imperatively is never put back
   * by the next render if the block's angle did not change — which is every
   * move and every resize. Blanking it therefore STRAIGHTENED a tilted tile
   * the first time it was dragged, and left it straight. Handing the angle
   * back here is what keeps a tilt through a drag.
   */
  const settledRotationRef = useRef(0);

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
      // NOT blanked: put the settled angle back. See settledRotationRef —
      // React will not restore an angle that did not change, so clearing this
      // is how a tilted tile used to straighten the moment it was moved.
      cell.style.rotate = settledRotationRef.current
        ? `${settledRotationRef.current}deg`
        : "";
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
  const readStrides = useCallback((): Strides | null => {
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

  /**
   * The edges of a block under a pointer, or null for the inner surface.
   *
   * ONE implementation for the hover cursor and for the press that starts a
   * resize, so the strip that shows a resize cursor is exactly the strip that
   * resizes. Both work in the block's own frame: its unrotated box, with the
   * pointer turned back into that frame first.
   */
  const edgeGrab = useCallback(
    (
      strides: Strides,
      block: GridBlock<TData>,
      clientX: number,
      clientY: number,
    ): ResizeEdges | null => {
      const box = cellBox(strides, block);
      // The pointer, brought back out of the painted tile's frame into the
      // stored rect's — a quarter-turned block may be drawn half a cell off it
      // (see snapShift), and half a cell is far wider than the grab strip, so
      // without this the edge under the hand is not the edge that resizes.
      const shift = snapShift(strides, block);
      const local = toLocalPoint(
        { x: box.centerX, y: box.centerY },
        block.rotation ?? 0,
        { x: clientX - shift.x, y: clientY - shift.y },
      );
      return edgesUnderPointer(box, local.x, local.y);
    },
    [],
  );

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
    settledRotationRef.current = block.rotation ?? 0;

    if (event.pointerType !== "touch") {
      // The block's OWN box, with the pointer un-rotated into the same frame,
      // so the strip under the hand is the tilted border the seller can see.
      // Derived from the grid's pitch rather than measured, because a turned
      // cell reports its axis-aligned envelope rather than its box.
      const edges = edgeGrab(strides, block, event.clientX, event.clientY);
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
   * Resize by dragging one of the block's own borders: the grabbed side
   * follows the hand, the opposite side stays where it is. A press that never
   * travels DRAG_THRESHOLD stays a click, so selecting a tile by its edge
   * still works. Preview painting reuses the same gestureRef pipeline as the
   * corner handle.
   *
   * The gesture runs in the BLOCK'S OWN frame (resizeLocalBox owns the
   * arithmetic, placementFromLocalBox puts the answer back on the board). The
   * edge the seller grabbed is the tilted border they can see, dragging it
   * outwards grows the tile along that same tilted axis, and the far corner is
   * pinned in screen space so the tile stretches instead of sliding.
   */
  function startEdgeResize(
    event: React.PointerEvent<HTMLLIElement>,
    block: GridBlock<TData>,
    edges: ResizeEdges,
  ) {
    const strides = readStrides();
    if (!strides) return;

    // The committed box, DERIVED from the grid rect and the pitch rather than
    // measured: the gesture mutates this element (and a turned one never
    // reported its real box in the first place), so measuring it would be the
    // preview measuring itself.
    const angle = block.rotation ?? 0;
    settledRotationRef.current = angle;
    const rect = cellBox(strides, block);
    const center = { x: rect.centerX, y: rect.centerY };
    // What the tile is painted off by, so the pointer can be read in the
    // stored rect's own frame and the live preview drawn where the hand is.
    const shift = snapShift(strides, block);
    const snapCells = footprintOffset(block, angle);
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
    // How far the drag may reach, in the block's own frame.
    const bounds = boardInLocalFrame(origin, angle, columns, rows);

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

      const { live, snapped, anchor } = resizeLocalBox(
        origin,
        edges,
        localPointerCell(
          strides,
          center,
          angle,
          moveEvent.clientX,
          moveEvent.clientY,
          shift,
        ),
        bounds,
        "edge",
      );
      // Whole cells, then held to the board: the STORED rect is what has to
      // stay on the canvas. Rounding is where a tilted resize gives up a
      // little accuracy — a turn can put the pinned corner half a cell off a
      // grid line, and half a cell is not storable while placements are whole
      // ones. It lands exactly with free placement.
      const candidate = clampToCanvas(
        roundPlacement(placementFromLocalBox(origin, angle, snapped, anchor)),
        columns,
        rows,
      );
      latest = candidate;
      latestValid = dropIsLegal(block, candidate, blocks);
      gestureRef.current = {
        key: block.key,
        mode: "resize",
        placement: candidate,
        // Re-derived from the candidate, so the ghost promises the cells the
        // block will really cover once it lands.
        footprint: rotatedFootprint(candidate, angle),
        valid: latestValid,
        // The LIVE box, not the snapped one: the border stays under the hand
        // while the ghost underneath shows where it will settle.
        ...previewBox(
          placementFromLocalBox(origin, angle, live, anchor),
          origin,
          strides,
          snapCells,
        ),
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
    if (!strides) return;

    // The committed box, DERIVED rather than measured, for the same two
    // reasons as startEdgeResize: the gesture mutates this element, and a
    // turned cell's bounding rect was never its box to begin with.
    const angle = block.rotation ?? 0;
    settledRotationRef.current = angle;
    const rect = cellBox(strides, block);
    const center = { x: rect.centerX, y: rect.centerY };
    // Same two as the edge drag: the pointer is read in the stored rect's
    // frame, and the preview is drawn where the gesture says rather than where
    // the tile's own snap nudge has it sitting.
    const shift = snapShift(strides, block);
    const snapCells = footprintOffset(block, angle);
    const origin: GridPlacement = {
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
    };
    let latest: GridPlacement = origin;
    let latestValid = true;
    setDragCursorLock(true);
    // One render, up front: mounts the ghost and lifts the tile.
    setActive({ key: block.key, mode: "resize" });

    /**
     * The handle sits in the tile's own bottom-right corner and turns with it,
     * so that is the corner it drags: the block's top-left CELL is the anchor
     * and always stays part of the result, and the span reaches from there to
     * wherever the hand is. Drag out and that is the familiar grow. Drag past
     * the anchor and the span lands on the other side of it, so one handle
     * stretches every way without a second control to aim for.
     *
     * All of it in the block's own frame, which is what makes a tilted tile
     * grow along the axis the hand is actually pulling.
     */
    const cornerEdges: ResizeEdges = { n: false, e: true, s: true, w: false };
    const bounds = boardInLocalFrame(origin, angle, columns, rows);

    /**
     * WHERE THE HAND GRABBED, relative to the cell the handle speaks for.
     *
     * The corner gesture names a CELL — "reach to whichever cell I am over" —
     * which was exact while the handle sat inside the corner it drags. It does
     * not any more: the handle hangs outside the tile (it was covering the
     * seller's own price tag and title in there), so at rest the hand is
     * already over the NEXT cell along, and a drag of one cell grew the block
     * by two.
     *
     * Taking the grab offset off every reading puts that right for good: the
     * press is read as though it had landed in the middle of the block's own
     * far corner cell, so the gesture means exactly what it always did and
     * stops depending on where the handle happens to be drawn.
     */
    const grabbedAtCell = localPointerCell(
      strides,
      center,
      angle,
      event.clientX,
      event.clientY,
      shift,
    );
    const grabOffset = {
      x: grabbedAtCell.x - (origin.x + origin.w - 0.5),
      y: grabbedAtCell.y - (origin.y + origin.h - 0.5),
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const pointer = localPointerCell(
        strides,
        center,
        angle,
        moveEvent.clientX,
        moveEvent.clientY,
        shift,
      );
      const { live, snapped, anchor } = resizeLocalBox(
        origin,
        cornerEdges,
        { x: pointer.x - grabOffset.x, y: pointer.y - grabOffset.y },
        bounds,
        "corner",
      );
      const candidate = clampToCanvas(
        roundPlacement(placementFromLocalBox(origin, angle, snapped, anchor)),
        columns,
        rows,
      );
      latest = candidate;
      latestValid = dropIsLegal(block, candidate, blocks);
      gestureRef.current = {
        key: block.key,
        mode: "resize",
        placement: candidate,
        footprint: rotatedFootprint(candidate, angle),
        valid: latestValid,
        // The box follows the hand; the ghost shows where it will snap.
        ...previewBox(
          placementFromLocalBox(origin, angle, live, anchor),
          origin,
          strides,
          snapCells,
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
    // The PAINTED centre: the handle orbits the tile the seller can see, and a
    // quarter-turned tile may be nudged half a cell off its stored box (see
    // snapShift). Every other gesture takes that nudge off the pointer; a spin
    // is the one that wants the pivot moved onto it instead.
    const shift = snapShift(strides, block);
    const center = { x: box.centerX + shift.x, y: box.centerY + shift.y };
    const origin = block.rotation ?? 0;
    settledRotationRef.current = origin;
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
      // Where the tile has to be left painting when the spin ends, so the
      // teardown hands the angle back rather than blanking it.
      settledRotationRef.current = latest;
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
    // The block's own border, so the strip that shows a resize cursor is the
    // one that resizes. The cursor arrow is then turned to face the way that
    // border does, since a tilted tile's top edge does not point up the screen.
    const edges = edgeGrab(strides, block, event.clientX, event.clientY);
    const next = edges ? edgeCursor(edges, block.rotation ?? 0) : "";
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
        ? keyboardResizeStep(block, delta)
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

  /** Which cells may rise for their own chrome without reordering the board
   *  under the seller. The rule itself is pure and lives with the rest of the
   *  paint-band math; see liftableChromeKeys. */
  const liftableKeys = useMemo(
    () => liftableChromeKeys(view.blocks),
    [view.blocks],
  );

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
              // Whether this cell may rise for its own chrome. Present when
              // doing so is invisible (nothing in front of it overlaps it);
              // absent when it would reorder the board under the seller. The
              // lift rules in globals.css require it — see `liftableKeys`.
              data-chrome-lift={liftableKeys.has(block.key) ? "" : undefined}
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
                // ALWAYS set, even for a block with no depth of its own. The
                // free-cell guides are rendered after the blocks (so they come
                // after them in the tab order, where they belong), and a grid
                // item at `z-index: auto` paints in document order — which put
                // every guide ON TOP of every tile. Invisible while the tile's
                // chrome lived inside it; the moment a handle hangs off the
                // edge, the guide underneath swallows the press meant for it.
                // A floor of one puts blocks above the guides (see EMPTY_CELL_Z)
                // without changing how they stack against EACH OTHER: with no
                // depth stated they all land on the same level and paint in
                // document order, exactly as they always have.
                zIndex: layerZIndex(block.z ?? 0),
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
                // ...and the half-cell nudge that keeps that tilt on the cells
                // the board reserved for it. Beside the tilt because it is part
                // of it: standing a block on its side is the only thing that
                // can knock it off, and this is what puts it back.
                ...snapToGridStyle(placement, block.rotation ?? 0),
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
                  data-tile-chrome=""
                  aria-label={label ? `Resize ${label}` : "Resize block"}
                  onPointerDown={(event) => startResize(event, block)}
                  className={cn(
                    HANDLE_CLASS,
                    HANDLE_ROW,
                    "right-0 cursor-nwse-resize touch-none select-none",
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
                  data-tile-chrome=""
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
                    HANDLE_ROW,
                    "left-0 cursor-grab touch-none select-none active:cursor-grabbing",
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
                  // Below the handle row, not in it: the handles moved out of
                  // the tile and now hold the strip this used to sit in.
                  className="pointer-events-none absolute left-0 top-full z-20 mt-8 rounded-sm border border-border bg-background/95 px-1.5 py-0.5 font-inter text-xs text-foreground shadow-xs"
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

        {/* Free cells. Clickable when the consumer wants insert-here.
            EMPTY_CELL_Z puts them under every block: they are drawn last so
            they land after the tiles in the tab order, and document order is
            what decides paint among grid items that state no depth. */}
        {emptyCells.map((cell) =>
          onEmptyCellClick && interactive ? (
            <li
              key={`empty-${cell.x}-${cell.y}`}
              style={{
                ...placementStyle({ ...cell, w: 1, h: 1 }),
                zIndex: EMPTY_CELL_Z,
              }}
            >
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
                zIndex: EMPTY_CELL_Z,
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
