"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveDiagonal2, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  clampOntoBoard,
  clampStep,
  footprintOffset,
  moveReach,
  rotatedFootprint,
} from "@/lib/geometry/rotated-box";
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
  columnsThatFit,
  edgeCursor,
  edgesUnderPointer,
  EMPTY_CELL_Z,
  keyboardResizeStep,
  layerZIndex,
  placementFromLocalBox,
  placementIsFree,
  invertReflowResize,
  reflowBlocks,
  reflowHasRoom,
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

/** Handle chrome — token-only. Hidden until the cell is hovered or focused, and
 *  kept out for as long as the consumer has marked the block SELECTED.
 *
 *  SELECTION IS THE WHOLE STORY ON A TOUCHSCREEN. These used to be drawn
 *  unconditionally there, on the grounds that a finger has no hover to reveal
 *  them with, but drawn for every tile they hung straight into the face of
 *  whatever block sat under each one, which on a phone read as clutter on the
 *  very form factor where they are the ONLY route to either gesture.
 *
 *  Tap-to-select-then-act costs one tap and is what a touchscreen expects
 *  anyway. `group-hover` carries its own `hover: hover` media query, so a
 *  pointer keeps its hover reveal and a finger simply never matches it.
 *
 *  OUTSIDE THE TILE, hanging just under its bottom edge (see HANDLE_ROW). A
 *  handle drawn on the tile is drawn on the SELLER'S WORK: the rotate control
 *  sat exactly where a price tag or a title band goes, so the thing being
 *  designed was hidden by the thing designing it. Out here they hang off the
 *  tile without ever covering it, and they still turn with it: they are drawn
 *  in the cell's chrome layer, which wears the cell's own tilt, so a tilted
 *  tile carries its controls round with it.
 *
 *  ABOVE EVERY BLOCK ON THE BOARD, always. That chrome layer is a sibling of
 *  the cell rather than part of it (see `chromeItem` in the render below), so
 *  the handles paint over any block, one stacked in front of this tile or one
 *  being dragged across them included, while the tile itself keeps its layer.
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
/**
 * FLOATING, not welded.
 *
 * These used to be drawn as tabs growing out of the tile's bottom edge: flush
 * against it, sharing its border, square where they touched. They are separate
 * round-cornered buttons hanging under it now, with clear air between — the
 * same treatment the selection toolbar gets, so everything the seller can
 * press reads as a tool held over the design rather than as part of it.
 *
 * THE GAP IS PAINT ONLY. `HANDLE_ROW` keeps the BUTTON's box welded to the
 * tile and spends the gap as transparent padding inside it (`pt-1.5`), while
 * the chrome — border, background, rounding — is worn by the span inside (see
 * HANDLE_FACE). So the pointer still crosses one continuous surface on its way
 * from the tile to the control, which is what keeps `:hover` on the cell and
 * the handle from fading out from under the hand reaching for it. A real gap
 * here is a strip of board belonging to neither, and it cost this editor that
 * exact bug once already (see 41-tile-chrome-outside).
 */
const HANDLE_CLASS = cn(
  "absolute z-20 inline-flex w-6 items-start justify-center",
  "text-muted-foreground transition-opacity duration-base ease-standard",
  "focus-visible:opacity-100 focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "motion-reduce:transition-none",
  // Hidden and inert until globals.css reveals them (the `[data-grid-chrome]`
  // rules). What reveals them is the tile hovered, focused or selected, and
  // those are states of the CELL, which is this layer's sibling rather than
  // its ancestor, so no `group-*` variant can reach them from here.
  "pointer-events-none opacity-0",
);

/** The strip the handles live in: hanging off the tile's bottom edge, flush
 *  with it (a hairline of overlap, `-mt-px`, rather than a gap — see
 *  HANDLE_CLASS for why). */
/** Welded box, floating paint: the hairline of overlap keeps the pointer on a
 *  continuous surface, and the padding is the air under the tile. */
const HANDLE_ROW = "top-full -mt-px pt-1.5";

/**
 * The part of a handle that is actually painted: a small square button in its
 * own right, bordered and rounded on every side.
 */
const HANDLE_FACE = cn(
  "inline-flex size-6 items-center justify-center rounded-sm",
  "border border-border bg-background shadow-xs",
  // The border takes the ring colour while the block is selected (globals.css,
  // beside the reveal), so a selected block and its controls read as one
  // object rather than three.
  "transition-colors duration-base ease-standard motion-reduce:transition-none",
  "group-hover/handle:text-foreground",
);

/** Suppress text selection for the duration of a drag. Module scope so the
 *  DOM write happens outside component/render scope. */
function setDragCursorLock(locked: boolean): void {
  document.body.style.userSelect = locked ? "none" : "";
}

/**
 * The grid line a block's stored rect is laid out from, held to the board.
 *
 * A turned block may legitimately STORE a rect that reaches past the board
 * (see isOnBoard: the cells it covers are what have to be on it), and a grid
 * line off the board does not exist. The browser does not clamp
 * `grid-row: 0 / span 3`, it DROPS it, and the tile falls into auto-placement
 * wherever the grid happens to find room. So the rect is laid out from the
 * nearest line that still holds its whole span, and snapToGridStyle paints the
 * difference back in whole cells.
 */
function boardLine(start: number, span: number, size: number): number {
  return Math.min(Math.max(0, start), Math.max(0, size - span));
}

function placementStyle(
  placement: GridPlacement,
  columns: number,
  rows: number,
): React.CSSProperties {
  return {
    gridColumn: `${boardLine(placement.x, placement.w, columns) + 1} / span ${placement.w}`,
    gridRow: `${boardLine(placement.y, placement.h, rows) + 1} / span ${placement.h}`,
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
  /** The board the cell is laid out on. placementStyle holds a stored rect
   *  that reaches past it onto its lines; the whole cells that cost are
   *  painted back here, through the same property as the half-cell nudge, so
   *  the two simply add. A turned bar lying across the top row stores y = -1,
   *  is laid out from line 1, and is painted a cell up from there. */
  columns: number,
  rows: number,
): React.CSSProperties {
  const offset = footprintOffset(placement, rotation);
  const shiftX =
    placement.x - boardLine(placement.x, placement.w, columns) + offset.x;
  const shiftY =
    placement.y - boardLine(placement.y, placement.h, rows) + offset.y;
  const pitch = (cells: number, span: number) =>
    `calc((100% + var(--grid-gap, 0px)) * ${cells} / ${span})`;
  return {
    ...(shiftX ? { left: pitch(shiftX, placement.w) } : {}),
    ...(shiftY ? { top: pitch(shiftY, placement.h) } : {}),
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
  /**
   * A GROUP MOVE'S whole cast, `key` included, when the block being dragged
   * belongs to a selection that travels with it. Absent for every other
   * gesture: a resize and a rotate are always about the one block the hand is
   * on (see `groupKeys` on the props).
   */
  keys?: readonly string[];
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
  /**
   * A group move's OTHER blocks — everything but `key`, which keeps the fields
   * above so a group of one paints exactly as a lone drag always has. They all
   * share the pointer's offset (the group travels as a rigid body), so only the
   * per-block landing is carried here.
   */
  others?: readonly { key: string; footprint: GridPlacement }[];
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
   *  cells and the drag ghost call it with the placement alone).
   *
   *  Occupied cells get the keys of every block under a gesture right now as
   *  well (empty when none is). A placement stays the COMMITTED one for the
   *  whole gesture, so a style that depends on where another block sits (a
   *  shape borrowing the corners of the product on top of it) reads this to
   *  know that block is on its way somewhere else. Only changes when a
   *  gesture starts or ends. */
  cellStyle?: (
    placement: GridPlacement,
    block?: GridBlock<TData>,
    gestureKeys?: ReadonlySet<string>,
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
  /**
   * BLOCKS THAT TRAVEL TOGETHER — the consumer's current selection.
   *
   * The grid still knows nothing about selection: it is handed a list of keys
   * and the one rule that a drag (or an arrow) starting on ANY of them carries
   * ALL of them, as one rigid body, by one whole-cell delta. That is the only
   * honest reading of "move these three": a group whose members each clamped
   * themselves to the board separately would arrive in a different arrangement
   * than it left in.
   *
   * So the delta is clamped against the group's OWN bounding box, and the whole
   * move is refused rather than deformed when it cannot land. Resize and rotate
   * stay per-block on purpose (the tile the hand is on is the one it means —
   * see onRotate's note in the storefront designer).
   */
  groupKeys?: readonly string[];
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
      onMoveMany?: undefined;
    })
  | (GridCommonProps<TData> & {
      editable: true;
      onMove: (key: string, x: number, y: number) => void;
      /** The WHOLE placement: dragging a west/north corner moves the origin as
       *  well as the extent, so w/h alone cannot describe the result. */
      onResize: (key: string, placement: GridPlacement) => void;
      /**
       * Where a whole group landed, in ONE call — so moving six tiles is one
       * act and one entry in the consumer's history, not six.
       *
       * OPTIONAL even in editable mode, unlike move and resize: `groupKeys` is
       * opt-in, and a consumer that never sends one never needs this. Without
       * it a drag on a selected block simply moves that block, exactly as it
       * always did.
       */
      onMoveMany?: (moves: readonly { key: string; x: number; y: number }[]) => void;
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
    onMoveMany,
    ariaLabel,
    getBlockLabel,
    className,
    cellClassName,
    cellStyle,
    showEmptyCells = false,
    onEmptyCellClick,
    onRotate,
    allowOverlap = false,
    groupKeys,
  } = props;
  const t = useTranslations("Common.grid");

  /** What the live region says once a spin settles. */
  const rotatedAnnouncement = (block: GridBlock<TData>, degrees: number) => {
    const label = getBlockLabel?.(block);
    return label === undefined
      ? t("rotatedBlock", { degrees })
      : t("rotated", { label, degrees });
  };

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
      allowOverlap ||
      placementIsFree(all, candidate, block.key, columns, rows, block.rotation ?? 0),
    [allowOverlap, columns, rows],
  );

  /** The board and the selection as of the last render, for the gestures to
   *  read when they need the CURRENT answer rather than the one that was true
   *  when the press landed. */
  const groupState = useRef({
    blocks,
    groupKeys,
    canMoveMany: onMoveMany !== undefined,
  });
  useEffect(() => {
    groupState.current = {
      blocks,
      groupKeys,
      canMoveMany: onMoveMany !== undefined,
    };
  });

  /**
   * The blocks a move on `key` carries: the consumer's selection when this
   * block is part of one, otherwise nothing (and the caller moves the block
   * alone, exactly as it always has).
   *
   * Resolved against the LIVE blocks rather than trusting the key list, so a
   * selection holding a key that has since left the board simply carries one
   * fewer block instead of moving a ghost.
   */
  const groupFor = useCallback((key: string): GridBlock<TData>[] | null => {
    // READ THROUGH A REF, not from this render's closure. A gesture asks this
    // question when the drag actually begins, which can be a moment after the
    // press that started it — a touch hold adds a tile to the selection with
    // the finger still down (see BlockTile) — and a closure captured at
    // pointerdown would carry the selection from before that.
    const { blocks: live, groupKeys: keys, canMoveMany } = groupState.current;
    if (!canMoveMany || !keys || keys.length < 2) return null;
    if (!keys.includes(key)) return null;
    const wanted = new Set(keys);
    const members = live.filter((block) => wanted.has(block.key));
    return members.length > 1 ? members : null;
  }, []);

  /**
   * The step a group can actually take, in whole cells.
   *
   * CLAMPED AS ONE BODY. Clamping each block separately would let the ones
   * with room keep going while the ones against the edge stopped, and the
   * group would arrive in a different arrangement than it left in — which is
   * the one thing "move these together" promises not to do.
   *
   * So each member states how far IT may travel and the group takes the
   * intersection. Tilt included (see moveReach): a turned member is held by
   * the cells it covers, not by a stored rect that can legitimately reach past
   * the board, which is what used to keep a selection holding a turned bar out
   * of the top and bottom rows. Every member's range includes standing still,
   * so the intersection does too, and a group already partly off the board
   * (undo and a column count change can both leave one there) simply cannot
   * go further off, rather than being forced anywhere.
   */
  const clampGroupStep = useCallback(
    (members: readonly GridBlock<TData>[], stepX: number, stepY: number) => {
      const reachX = { min: -Infinity, max: Infinity };
      const reachY = { min: -Infinity, max: Infinity };
      for (const block of members) {
        const reach = moveReach(block, block.rotation ?? 0, columns, rows);
        reachX.min = Math.max(reachX.min, reach.x.min);
        reachX.max = Math.min(reachX.max, reach.x.max);
        reachY.min = Math.max(reachY.min, reach.y.min);
        reachY.max = Math.min(reachY.max, reach.y.max);
      }
      return { x: clampStep(stepX, reachX), y: clampStep(stepY, reachY) };
    },
    [columns, rows],
  );

  /**
   * Whether the whole group may land on that step. ALL OR NOTHING: a group is
   * one object here, so one member with nowhere to go springs the whole move
   * back rather than leaving the selection half-moved.
   *
   * Members are measured against the blocks OUTSIDE the group only — they are
   * all travelling by the same delta, so a group whose own blocks touch stays
   * exactly as legal as it was before the drag.
   */
  const groupDropIsLegal = useCallback(
    (members: readonly GridBlock<TData>[], step: { x: number; y: number }) => {
      if (allowOverlap) return true;
      const wanted = new Set(members.map((block) => block.key));
      const outsiders = blocks.filter((block) => !wanted.has(block.key));
      return members.every((block) =>
        placementIsFree(
          outsiders,
          { x: block.x + step.x, y: block.y + step.y, w: block.w, h: block.h },
          block.key,
          columns,
          rows,
          block.rotation ?? 0,
        ),
      );
    },
    [allowOverlap, blocks, columns, rows],
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
  /** Each cell's chrome layer (the sibling `li[data-grid-chrome]`), by key. A
   *  gesture moves, stretches and turns the cell imperatively, and the handles
   *  have to go with it, so every such write lands on both. */
  const chromeNodes = useRef(new Map<string, HTMLLIElement>());
  const ghostRef = useRef<HTMLLIElement | null>(null);
  /** The ghosts for a group move's OTHER blocks, by key. The dragged block's
   *  own ghost stays on `ghostRef`, so a lone drag is unchanged. */
  const ghostNodes = useRef(new Map<string, HTMLLIElement>());
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
  /**
   * The same angle, per block, for a GROUP move — where "the tile" is several
   * tiles, each with a tilt of its own. Empty for every other gesture, which is
   * what leaves the single-block path reading `settledRotationRef` exactly as
   * it always has.
   */
  const groupRotationsRef = useRef(new Map<string, number>());

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
    // The cell AND its chrome layer, so the handles ride every frame of the
    // gesture exactly where the tile is drawn. Validity stays the cell's
    // alone: it is what colours the ring.
    const boxes = (key: string) =>
      [cellNodes.current.get(key), chromeNodes.current.get(key)].filter(
        (node): node is HTMLLIElement => node !== undefined,
      );
    if (cell) {
      if (gesture.mode === "move") {
        for (const node of boxes(gesture.key)) {
          node.style.translate = `${gesture.offset.x}px ${gesture.offset.y}px`;
        }
        // THE REST OF THE GROUP, by the SAME offset. The selection travels as
        // a rigid body, so there is one offset for all of it and the blocks
        // keep their spacing all the way across the board.
        for (const other of gesture.others ?? []) {
          const node = cellNodes.current.get(other.key);
          if (!node) continue;
          for (const box of boxes(other.key)) {
            box.style.translate = `${gesture.offset.x}px ${gesture.offset.y}px`;
          }
          node.dataset.valid = String(gesture.valid);
        }
      } else if (gesture.mode === "rotate") {
        for (const node of boxes(gesture.key)) {
          node.style.rotate = `${gesture.rotation ?? 0}deg`;
        }
      } else if (gesture.size) {
        // Resizing translates as well as stretches: a tile keeps its committed
        // cell in the layout, so growing west/north has to be drawn as "same
        // box, shifted back" or the pinned edge would visibly drift.
        for (const node of boxes(gesture.key)) {
          node.style.translate = `${gesture.offset.x}px ${gesture.offset.y}px`;
          node.style.width = `${gesture.size.w}px`;
          node.style.height = `${gesture.size.h}px`;
        }
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
    //
    // ONE PER BLOCK for a group move, so a selection being carried shows every
    // landing spot rather than one block's and a shrug about the other five.
    function paintGhost(node: HTMLLIElement | null, covered: GridPlacement) {
      if (!node) return;
      const left = Math.max(0, covered.x);
      const top = Math.max(0, covered.y);
      node.style.gridColumn = `${left + 1} / span ${Math.max(1, covered.x + covered.w - left)}`;
      node.style.gridRow = `${top + 1} / span ${Math.max(1, covered.y + covered.h - top)}`;
      node.dataset.valid = String(gesture!.valid);
    }
    paintGhost(ghostRef.current, gesture.footprint);
    for (const other of gesture.others ?? []) {
      paintGhost(ghostNodes.current.get(other.key) ?? null, other.footprint);
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
    // Every cell the gesture touched, which for a group move is all of them.
    for (const key of gesture ? (gesture.keys ?? [gesture.key]) : []) {
      const cell = cellNodes.current.get(key);
      if (!cell) continue;
      // NOT blanked: put the settled angle back. See settledRotationRef —
      // React will not restore an angle that did not change, so clearing this
      // is how a tilted tile used to straighten the moment it was moved. Each
      // member of a group carries its own tilt, hence the map.
      const angle =
        groupRotationsRef.current.get(key) ?? settledRotationRef.current;
      // The chrome layer is handed back with its cell, for the same reasons.
      const chrome = chromeNodes.current.get(key);
      for (const node of chrome ? [cell, chrome] : [cell]) {
        node.style.translate = "";
        node.style.rotate = angle ? `${angle}deg` : "";
        node.style.width = "";
        node.style.height = "";
      }
      delete cell.dataset.valid;
    }
    gestureRef.current = null;
    groupRotationsRef.current.clear();
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

  /**
   * COORDINATES ARE HONOURED, so a gesture that writes them is meaningful.
   * False on a reflowed board, where what is on screen was repacked and no
   * longer corresponds to what is stored: a move or a resize there would
   * write the derived layout back as the design, silently rearranging a board
   * the seller cannot see the real shape of.
   */
  const interactive = editable && !view.reflowed;

  /**
   * ROTATION IS NOT A COORDINATE, and this is why it has a flag of its own.
   *
   * It used to ride on `interactive`, which meant a reflowed board — every
   * board in the storefront designer's mobile preview, which repacks to fit a
   * phone's width — lost its rotate handle along with its resize handle. But
   * the two are not alike: a resize writes a placement, which a reflowed board
   * cannot honestly express, while a rotate writes an ANGLE on the block. It
   * is stored as-is, means the same thing at every column count, and is
   * already editable from the inspector's own Rotation slider while the board
   * is reflowed. Withholding only the on-canvas handle made the seller hunt
   * for a control the panel beside them was still offering.
   */
  const rotatable = editable;

  /**
   * RESIZE, PER BLOCK, is a narrower ask than "interactive": a repacked board
   * cannot honour coordinates in general, but a corner drag that only GROWS a
   * tile is a delta, not an absolute placement, and a delta survives a change
   * of column count by scaling through the same ratio reflow used to shrink
   * it (see the reflow branch inside startResize). What it cannot survive is
   * having nowhere left to grow — a tile already spanning the full width and
   * the full height of the repacked layout truly has no room, on this board,
   * in any direction, and that (not "the board happens to be reflowed") is
   * the one thing worth disabling the handle for.
   */
  const resizableBlock = useCallback(
    (block: { w: number; h: number }) =>
      editable && (!view.reflowed || reflowHasRoom(block, renderColumns, view.rows)),
    [editable, view.reflowed, renderColumns, view.rows],
  );

  const rootStyle: GridVars = {
    "--ss-cols": renderColumns,
    "--ss-rows": view.rows,
  };

  /** What a landing spot looks like. One class, because a group move draws
   *  several of them and they have to be the same mark. */
  const GHOST_CLASS = cn(
    "pointer-events-none border-2 border-dashed",
    "data-[valid=true]:border-ring data-[valid=true]:bg-accent/40",
    "data-[valid=false]:border-destructive data-[valid=false]:bg-destructive/10",
    GRID_CELL_RADIUS_CLASS,
    cellClassName,
  );

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

    /**
     * WHO TRAVELS. A press on a block the consumer has marked as part of a
     * selection carries the whole selection; anything else carries itself.
     *
     * Settled when the DRAG STARTS, not when the press lands, and then never
     * again — a touch hold adds the pressed tile to the selection with the
     * finger still down (see BlockTile), so a cast taken at pointerdown would
     * carry the block on its own and leave the group it had just joined
     * behind; and a cast re-taken every frame could drop half a group mid-way
     * across the board.
     */
    let group: GridBlock<TData>[] | null = null;
    let groupKeyList: string[] | undefined;
    let origins: {
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
      rotation: number;
    }[] = [];

    let dragging = false;
    let latestStep = { x: 0, y: 0 };
    let latestValid = true;

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      // A short press is a click (select); only real travel starts a drag.
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        group = groupFor(block.key);
        groupKeyList = group?.map((member) => member.key);
        origins = (group ?? [block]).map((member) => ({
          key: member.key,
          x: member.x,
          y: member.y,
          w: member.w,
          h: member.h,
          rotation: member.rotation ?? 0,
        }));
        // Each member's own tilt, so ending the drag hands every one of them
        // back the angle it was painting at (see clearGestureStyles).
        groupRotationsRef.current.clear();
        if (group) {
          for (const member of group) {
            groupRotationsRef.current.set(member.key, member.rotation ?? 0);
          }
        }
        setDragCursorLock(true);
        // The only render this gesture causes: it mounts the ghost(s) and marks
        // the tile — or the whole group — as lifted.
        setActive({ key: block.key, mode: "move", keys: groupKeyList });
      }
      const rawX = Math.round(dx / strides.strideX);
      const rawY = Math.round(dy / strides.strideY);
      // One clamp for the group (as one body, so it keeps its arrangement);
      // the block's own for a lone drag. Both hold a block to the board by
      // the cells it COVERS, so a turned block reaches every row and column it
      // visibly fits in, instead of stopping wherever its stored rect would
      // reach past an edge (see moveReach).
      if (group) {
        latestStep = clampGroupStep(group, rawX, rawY);
      } else {
        const reach = moveReach(origin, block.rotation ?? 0, columns, rows);
        latestStep = { x: clampStep(rawX, reach.x), y: clampStep(rawY, reach.y) };
      }
      const candidate: GridPlacement = {
        ...origin,
        x: origin.x + latestStep.x,
        y: origin.y + latestStep.y,
      };
      latestValid = group
        ? groupDropIsLegal(group, latestStep)
        : dropIsLegal(block, candidate, blocks);
      gestureRef.current = {
        key: block.key,
        mode: "move",
        keys: groupKeyList,
        placement: candidate,
        footprint: rotatedFootprint(candidate, block.rotation ?? 0),
        valid: latestValid,
        // Unscaled, so the tile tracks the cursor 1:1 at any zoom.
        offset: { x: dx / strides.scale, y: dy / strides.scale },
        others: group
          ? origins
              .filter((member) => member.key !== block.key)
              .map((member) => ({
                key: member.key,
                footprint: rotatedFootprint(
                  {
                    x: member.x + latestStep.x,
                    y: member.y + latestStep.y,
                    w: member.w,
                    h: member.h,
                  },
                  member.rotation,
                ),
              }))
          : undefined,
      };
      scheduleGesturePaint();
    };

    const handleUp = () => {
      endGesture(handleMove, handleUp);
      // An invalid drop springs back: committing would overlap a neighbour.
      if (!dragging || !latestValid) return;
      if (latestStep.x === 0 && latestStep.y === 0) return;
      // A group lands in ONE call, so carrying six tiles is one act and one
      // entry in the consumer's history rather than six.
      if (group && onMoveMany) {
        onMoveMany(
          origins.map((member) => ({
            key: member.key,
            x: member.x + latestStep.x,
            y: member.y + latestStep.y,
          })),
        );
        return;
      }
      onMove?.(block.key, origin.x + latestStep.x, origin.y + latestStep.y);
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
      // Whole cells, then held to the board by the same per-axis rule a saved
      // block is (see clampOntoBoard): left where it is when either its
      // footprint or its stored rect is on the board, so resizing a turned
      // bar lying across the top row never shoves it down a row. Rounding is
      // where a tilted resize gives up a little accuracy — a turn can put the
      // pinned corner half a cell off a grid line, and half a cell is not
      // storable while placements are whole ones. It lands exactly with free
      // placement.
      const candidate = clampOntoBoard(
        roundPlacement(placementFromLocalBox(origin, angle, snapped, anchor)),
        angle,
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
    if (!resizableBlock(block) || event.button !== 0) return;
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
     * REFLOWED: `block` (and so `origin`) is the repacked box drawn on
     * screen, not the stored one — exactly what the ghost and the strides
     * need to track the hand correctly. The drag stays inside THAT board
     * (`boundsColumns`/`boundsRows`, `siblingsForLegality`) for the same
     * reason: those are the cells actually free on the layout the seller is
     * looking at. `ratio` is reflow's own scale, run backwards on the
     * DELTA at commit time (see handleUp) to turn "grew by one shown cell"
     * into the right number of stored ones, whatever this tile's real
     * column count happens to be.
     */
    const reflowed = view.reflowed;
    const boundsColumns = reflowed ? renderColumns : columns;
    const boundsRows = reflowed ? view.rows : rows;
    const siblingsForLegality = reflowed ? view.blocks : blocks;
    const ratio = reflowed ? renderColumns / columns : 1;
    const realOrigin = reflowed
      ? (blocks.find((sibling) => sibling.key === block.key) ?? block)
      : block;

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
    const bounds = boardInLocalFrame(origin, angle, boundsColumns, boundsRows);

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
      // Held to the board the way the edge drag is (see clampOntoBoard), so a
      // turned block against an edge is never shoved off the row it lies in.
      const candidate = clampOntoBoard(
        roundPlacement(placementFromLocalBox(origin, angle, snapped, anchor)),
        angle,
        boundsColumns,
        boundsRows,
      );
      latest = candidate;
      latestValid = dropIsLegal(block, candidate, siblingsForLegality);
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
        latest.x === origin.x &&
        latest.y === origin.y &&
        latest.w === origin.w &&
        latest.h === origin.h
      ) {
        return;
      }
      if (!reflowed) {
        onResize?.(block.key, latest);
        return;
      }
      const real = invertReflowResize(origin, latest, realOrigin, ratio, columns, rows);
      if (
        real.x !== realOrigin.x ||
        real.y !== realOrigin.y ||
        real.w !== realOrigin.w ||
        real.h !== realOrigin.h
      ) {
        onResize?.(block.key, real);
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
    if (!rotatable || !onRotate || event.button !== 0) return;
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
      setAnnouncement(rotatedAnnouncement(block, latest));
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
      setAnnouncement(rotatedAnnouncement(block, next));
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

    // AN ARROW MOVES WHAT A DRAG MOVES. A nudge on a block that is part of the
    // consumer's selection carries the whole selection, by the same clamped
    // step, as one act — otherwise the keyboard and the pointer would disagree
    // about what "move this" means. Shift is a resize, which stays per block.
    const group = event.shiftKey ? null : groupFor(block.key);
    if (group && onMoveMany) {
      const step = clampGroupStep(group, delta[0], delta[1]);
      // Into the board's edge: nothing to report, and reporting it would push
      // an undo step for a key press that did nothing.
      if (step.x === 0 && step.y === 0) return;
      if (!groupDropIsLegal(group, step)) return;
      onMoveMany(
        group.map((member) => ({
          key: member.key,
          x: member.x + step.x,
          y: member.y + step.y,
        })),
      );
      setAnnouncement(t("blocksMoved", { count: group.length }));
      return;
    }

    // Held to the board by the cells the block COVERS, exactly as a drag is,
    // so arrows walk a turned block into every row and column it fits in. A
    // resize has no origin to measure a step from, so it is only put back on
    // the board when the new span pushed it off (see clampOntoBoard).
    const angle = block.rotation ?? 0;
    const reach = moveReach(block, angle, columns, rows);
    const candidate: GridPlacement = event.shiftKey
      ? clampOntoBoard(keyboardResizeStep(block, delta), angle, columns, rows)
      : {
          x: block.x + clampStep(delta[0], reach.x),
          y: block.y + clampStep(delta[1], reach.y),
          w: block.w,
          h: block.h,
        };
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

  /** Every block under a gesture, for cellStyle. Follows `active`, which is
   *  set once when a gesture starts and cleared when it ends. */
  const gestureKeys = useMemo<ReadonlySet<string>>(
    () => new Set(active ? (active.keys ?? [active.key]) : []),
    [active],
  );

  return (
    <div ref={containerRef} className={cn(GRID_CONTAINER_CLASS, className)}>
      <ul
        ref={gridRef}
        aria-label={ariaLabel ?? t("ariaLabel")}
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
            className={GHOST_CLASS}
          />
        )}

        {/* One more per block for a group move: a selection being carried
            shows every landing spot, not just the dragged tile's. */}
        {active?.keys
          ?.filter((key) => key !== active.key)
          .map((key) => (
            <li
              key={`ghost-${key}`}
              ref={(node) => {
                if (node) ghostNodes.current.set(key, node);
                else ghostNodes.current.delete(key);
              }}
              aria-hidden="true"
              data-valid="true"
              style={cellStyle?.({ x: 0, y: 0, w: 1, h: 1 })}
              className={GHOST_CLASS}
            />
          ))}

        {view.blocks.map((block) => {
          // A group move lifts every block it is carrying, so each of them
          // gets the shadow, the ring and the depth the dragged tile gets.
          const gesture =
            active &&
            (active.keys
              ? active.keys.includes(block.key)
              : active.key === block.key)
              ? active
              : null;
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
          const cellItem = (
            <li
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
                ...placementStyle(placement, renderColumns, view.rows),
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
                ...cellStyle?.(placement, block, gestureKeys),
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
                ...snapToGridStyle(placement, block.rotation ?? 0, renderColumns, view.rows),
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
            </li>
          );

          // THE TILE'S CHROME, IN A LAYER OF ITS OWN: the sibling right after
          // the cell, on the same grid area, turned and nudged the same way,
          // and moved with it by the gesture painter (see chromeNodes).
          //
          // A cell is its own stacking context, so a handle inside it could
          // only clear the blocks around it by lifting the whole cell,
          // content and all, and a block with something in front of it
          // cannot be lifted without jumping out of its layer, which left
          // exactly those handles buried under the block in front. Out here
          // the cell keeps the depth its layer gives it, and the handles sit
          // above every block on the board, a dragged or framed one included.
          //
          // When they show, and at what level, is globals.css's business (the
          // `[data-grid-chrome]` rules): hover, focus and selection are states
          // of the CELL, and CSS can reach a sibling where React would have to
          // re-render the board on every pointer crossing.
          const chromeItem = editable ? (
            <li
              ref={(node) => {
                if (node) chromeNodes.current.set(block.key, node);
                else chromeNodes.current.delete(block.key);
              }}
              data-grid-chrome={block.key}
              // Keys on a focused handle mean what they mean on the tile, as
              // they did while the handles lived inside the cell.
              onKeyDown={
                interactive ? (event) => onCellKeyDown(event, block) : undefined
              }
              style={{
                // The cell's own box, tilt and half-cell nudge, so the handles
                // hang exactly where the tile is drawn. Never the cell's
                // depth: the band this layer paints at is the point of it.
                ...placementStyle(placement, renderColumns, view.rows),
                ...(block.rotation ? { rotate: `${block.rotation}deg` } : {}),
                ...snapToGridStyle(placement, block.rotation ?? 0, renderColumns, view.rows),
                ...(gesture ? { willChange: "translate, rotate" } : {}),
              }}
              className="relative"
            >
              {/* One resize handle. Drag it ANY direction: past the tile's own
                  top-left it flips and the tile grows up / left instead.
                  Arrows (with Shift, on the tile) do the same from the
                  keyboard. */}

              {/* DRAWN EVEN WHERE IT CANNOT WORK, and saying so. A reflowed
                  board repacked its blocks to fit the width it was given, so
                  a resize on it has to land back on the STORED design rather
                  than the repacked one (see the reflow branch inside
                  startResize) — every tile still gets a working handle as
                  long as it has somewhere left to grow on the repacked board,
                  and only one already spanning that board's full width and
                  full height is truly out of room. The handle no longer
                  simply VANISHES there either: a control that disappears
                  without a word reads as a broken editor, and on a phone
                  (where the storefront's mobile preview is often reflowed) it
                  was the second of the two handles to go missing with no
                  explanation. It sits in its usual place, plainly inert, and
                  its accessible name carries the reason. */}
              {editable && (
                <button
                  type="button"
                  data-tile-chrome=""
                  aria-disabled={!resizableBlock(block)}
                  aria-label={
                    resizableBlock(block)
                      ? label
                        ? t("resize", { label })
                        : t("resizeBlock")
                      : label
                        ? t("resizeUnavailableNamed", { label })
                        : t("resizeUnavailable")
                  }
                  onPointerDown={(event) => startResize(event, block)}
                  className={cn(
                    HANDLE_CLASS,
                    HANDLE_ROW,
                    "group/handle right-0 touch-none select-none",
                    resizableBlock(block)
                      ? "cursor-nwse-resize"
                      : "cursor-not-allowed text-muted-foreground/40",
                  )}
                >
                  <span className={HANDLE_FACE}>
                    <MoveDiagonal2
                      className="size-3.5"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </span>
                </button>
              )}

              {/* Rotate handle, mirroring the resize handle across the tile so
                  the two are never confused for one another. Inside the cell
                  rather than floating outside it, so a 1x1 tile at the board's
                  edge still has something to reach for.

                  role=slider carries the angle to assistive tech, which is the
                  accessible pattern for a draggable handle holding a value;
                  Alt+Arrows on the tile itself is the keyboard route. */}
              {rotatable && onRotate && (
                <button
                  type="button"
                  data-tile-chrome=""
                  role="slider"
                  aria-label={label ? t("rotate", { label }) : t("rotateBlock")}
                  aria-valuemin={-180}
                  aria-valuemax={180}
                  aria-valuenow={block.rotation ?? 0}
                  aria-valuetext={t("rotation", { degrees: block.rotation ?? 0 })}
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
                    "group/handle left-0 cursor-grab touch-none select-none active:cursor-grabbing",
                  )}
                >
                  <span className={HANDLE_FACE}>
                    <RotateCw
                      className="size-3.5"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </span>
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
                  className="pointer-events-none absolute left-0 top-full z-20 mt-9 rounded-sm border border-border bg-background/95 px-1.5 py-0.5 font-inter text-xs text-foreground shadow-xs"
                >
                  {/* Seeded with the angle the spin STARTED at, so a press
                      that has not travelled yet shows a number rather than an
                      empty chip. The painter takes over from the first move. */}
                  {`${block.rotation ?? 0}°`}
                </span>
              )}
            </li>
          ) : null;

          return (
            <Fragment key={block.key}>
              {cellItem}
              {chromeItem}
            </Fragment>
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
                ...placementStyle({ ...cell, w: 1, h: 1 }, renderColumns, view.rows),
                zIndex: EMPTY_CELL_Z,
              }}
            >
              <button
                type="button"
                // Marks a FREE-cell control: a consumer's drag gesture (the
                // designer's marquee) may start here, unlike real controls.
                data-grid-empty=""
                onClick={() => onEmptyCellClick(cell.x, cell.y)}
                aria-label={t("addBlockAt", { column: cell.x + 1, row: cell.y + 1 })}
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
                ...placementStyle({ ...cell, w: 1, h: 1 }, renderColumns, view.rows),
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
