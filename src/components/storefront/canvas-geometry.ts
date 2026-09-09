/**
 * PANEL-AWARE CANVAS GEOMETRY.
 *
 * The designer's workspace is a window onto a board that floats behind it, and
 * the panels around that window come and go: the colour/library column on the
 * left, the design column on the right, and on a phone those same surfaces as
 * bottom sheets laid straight over the canvas.
 *
 * Opening one used to shove the board sideways. The pan is measured from the
 * workspace's own top-left corner, and a docked column appearing beside the
 * workspace MOVES that corner, so a board that had not moved at all in the
 * seller's eyes jumped by the width of the panel.
 *
 * The rule this module encodes is two lines long:
 *
 *   1. HOLD STILL. The board is pinned to the SCREEN, not to the workspace. A
 *      panel that opens over space the board was not using changes nothing.
 *   2. RECOVER, MINIMALLY. Only when the panel actually stands on the board
 *      does the board move, and then by the least amount that gets it back out
 *      from under it.
 *
 * Everything here is pure and measured in CSS pixels, which is what lets one
 * pair of rules cover a docked column (it shrinks the workspace box) and a
 * floating sheet (it leaves the box alone and covers it instead) without either
 * being written as a special case. Neither is a panel "side" ever hard-coded:
 * an inset is derived from where a panel actually lands, so a drawer from any
 * edge, at any size, is handled by the same arithmetic.
 */

/** A rectangle in CSS pixels. Client coordinates unless a call site says
 *  otherwise. */
export type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** How deep into the workspace each edge is covered by a floating panel. All
 *  zero on desktop, where the panels are docked beside the workspace rather
 *  than over it. */
export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Sub-pixel differences are layout noise (fractional device pixels, a border
 *  rounding), never a panel opening. */
const EPSILON = 0.5;

/**
 * How much of the workspace's cross axis a panel must span before it counts as
 * a wall rather than a floating widget. A bottom sheet runs the full width and
 * genuinely costs the canvas that band; a popover or a toast sitting in one
 * corner does not, and reserving a whole edge for it would throw away room the
 * board is entitled to.
 */
const EDGE_COVERAGE = 0.6;

/**
 * A panel deeper than this share of an axis has not left a usable strip on the
 * other side, so there is nowhere to recover TO. Better to leave the board
 * exactly where the seller put it than to shuffle it inside a sliver.
 */
const MAX_INSET_RATIO = 0.9;

/** The narrowest strip still worth treating as workspace. Below this the
 *  insets are ignored and the full box is used. */
const MIN_SAFE_PX = 64;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

export function boxesEqual(a: Box, b: Box): boolean {
  return (
    near(a.left, b.left) &&
    near(a.top, b.top) &&
    near(a.width, b.width) &&
    near(a.height, b.height)
  );
}

export function insetsEqual(a: Insets, b: Insets): boolean {
  return (
    near(a.top, b.top) &&
    near(a.right, b.right) &&
    near(a.bottom, b.bottom) &&
    near(a.left, b.left)
  );
}

export function mergeInsets(a: Insets, b: Insets): Insets {
  return {
    top: Math.max(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    left: Math.max(a.left, b.left),
  };
}

/**
 * The inset ONE panel takes out of the workspace.
 *
 * A panel that does not overlap the workspace at all costs nothing: that is
 * every docked column on desktop, which is laid out beside the canvas and has
 * already been paid for in the workspace's own width.
 *
 * A panel that DOES overlap is attributed to whichever edge it is cheapest to
 * clear it from. That single test is what makes the rule side-agnostic: a
 * full-width bottom sheet is flush with three edges at once, so "which edge is
 * it touching" has no answer, while "how far in would I have to come to be past
 * it" has exactly one sensible one.
 */
export function panelInset(workspace: Box, panel: Box): Insets {
  if (workspace.width <= 0 || workspace.height <= 0) return NO_INSETS;
  if (panel.width <= EPSILON || panel.height <= EPSILON) return NO_INSETS;

  const workspaceRight = workspace.left + workspace.width;
  const workspaceBottom = workspace.top + workspace.height;
  const panelRight = panel.left + panel.width;
  const panelBottom = panel.top + panel.height;

  const overlapWidth =
    Math.min(workspaceRight, panelRight) - Math.max(workspace.left, panel.left);
  const overlapHeight =
    Math.min(workspaceBottom, panelBottom) - Math.max(workspace.top, panel.top);
  // Docked beside the canvas, not over it.
  if (overlapWidth <= EPSILON || overlapHeight <= EPSILON) return NO_INSETS;

  const candidates: {
    side: keyof Insets;
    depth: number;
    coverage: number;
    axis: number;
  }[] = [
    {
      side: "left",
      depth: panelRight - workspace.left,
      coverage: overlapHeight / workspace.height,
      axis: workspace.width,
    },
    {
      side: "right",
      depth: workspaceRight - panel.left,
      coverage: overlapHeight / workspace.height,
      axis: workspace.width,
    },
    {
      side: "top",
      depth: panelBottom - workspace.top,
      coverage: overlapWidth / workspace.width,
      axis: workspace.height,
    },
    {
      side: "bottom",
      depth: workspaceBottom - panel.top,
      coverage: overlapWidth / workspace.width,
      axis: workspace.height,
    },
  ];

  let best: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (candidate.coverage < EDGE_COVERAGE) continue;
    if (candidate.depth <= EPSILON) continue;
    if (candidate.depth > candidate.axis * MAX_INSET_RATIO) continue;
    if (!best || candidate.depth < best.depth) best = candidate;
  }
  if (!best) return NO_INSETS;
  return { ...NO_INSETS, [best.side]: best.depth };
}

/**
 * The stretch of one workspace axis no panel is standing on, in workspace
 * coordinates (0 = the workspace's own leading edge, which is where the pan is
 * measured from).
 *
 * Falls back to the WHOLE axis when the insets would leave less than a usable
 * strip: with nowhere to move to, holding the board still beats shuffling it
 * around inside a sliver.
 */
export function safeSpan(
  size: number,
  startInset: number,
  endInset: number,
): [min: number, max: number] {
  const min = startInset;
  const max = size - endInset;
  return max - min >= MIN_SAFE_PX ? [min, max] : [0, size];
}

/**
 * The smallest move along one axis that brings a run of `size` starting at
 * `pos` back inside `[min, max]`.
 *
 * Zero when it is already inside, which is the whole point of this file: a
 * panel opening over space the board was not using moves nothing.
 *
 * Zero as well when the content is BIGGER than the room it has. No position
 * shows all of it, so sliding would only swap which part is hidden, and a
 * seller who opens a colour panel does not expect the board to slide out from
 * under their cursor to trade one cropped edge for the other. Making sure such
 * a board never disappears entirely is the viewport's keep-visible clamp's job,
 * not this function's.
 */
export function slideIntoView(
  pos: number,
  size: number,
  min: number,
  max: number,
): number {
  const room = max - min;
  if (room <= 0) return 0;
  if (size >= room) return 0;
  if (pos < min) return min - pos;
  if (pos + size > max) return max - (pos + size);
  return 0;
}

/** Which ends of an axis the change TOOK workspace from, as opposed to gave
 *  back. Only a side that lost room can ask the board to move. */
type Taken = { leading: boolean; trailing: boolean };

/**
 * Rule 2 along one axis: give back what the panel took, and nothing else.
 *
 * The guard is the whole point. A seller is allowed to park the board half off
 * the workspace (working at an edge is a normal thing to do), and a panel
 * merely CHANGING SIZE is not permission to undo that. Without it, closing a
 * panel would haul a deliberately parked board back across the screen, because
 * the room it freed made an edge "recoverable" that nothing had taken.
 *
 * So a slide away from an edge is allowed only when that edge is the one that
 * just closed in.
 */
function recover(
  pos: number,
  size: number,
  taken: Taken,
  [min, max]: [number, number],
): number {
  const move = slideIntoView(pos, size, min, max);
  if (move > 0 && !taken.leading) return 0;
  if (move < 0 && !taken.trailing) return 0;
  return move;
}

/**
 * Which box has to be kept visible along one axis, given the room there is:
 * the first candidate that FITS, in the order they are wanted.
 *
 * The candidates run from most to least generous, and the order is the whole
 * argument. The WHOLE BOARD first, because showing all of it is strictly
 * better than showing one tile of it: a board left tucked a few px under a
 * panel it could have cleared completely reads as a bug rather than as
 * restraint. Then the selection WITH ITS CHROME, because a tile revealed with
 * its own resize and rotate handles still buried under the panel has not
 * really been revealed — on a phone those handles are always drawn and are the
 * only route to either gesture. Then the bare selection, for a strip too short
 * to hold even that.
 *
 * The last candidate is used when none fits, and it has to be the smallest:
 * `slideIntoView` refuses to move anything bigger than the room it has (no
 * position shows all of it, so sliding would only swap which edge is hidden),
 * so naming a box that cannot fit is the same as asking for no move at all.
 *
 * Per axis, so the answers can differ: on a phone with a sheet up the board
 * usually still fits across and cannot fit down, and both of those are right.
 */
function keepVisible(
  [min, max]: [number, number],
  ...candidates: { start: number; size: number }[]
): { start: number; size: number } {
  const room = max - min;
  return (
    candidates.find((candidate) => candidate.size <= room) ??
    candidates[candidates.length - 1]
  );
}

/** Compare the visible stretch before and after ON SCREEN: the workspace's own
 *  corner may have moved between the two, so its local coordinates cannot be
 *  compared directly. */
function takenFrom(
  previousOrigin: number,
  [wasMin, wasMax]: [number, number],
  origin: number,
  [min, max]: [number, number],
): Taken {
  return {
    leading: origin + min > previousOrigin + wasMin + EPSILON,
    trailing: origin + max < previousOrigin + wasMax - EPSILON,
  };
}

/**
 * The pan the board should have after the workspace's box or its panel cover
 * changed: rule 1 then rule 2, in that order.
 *
 * The two come back SEPARATELY because they are played at different speeds.
 * `hold` is a correction, not a move: the board is already meant to be there,
 * and easing into it would draw the very slide the correction exists to hide.
 * `pan` is where the board should end up once it has also got out from under a
 * panel standing on it, and THAT is a move, so it eases.
 *
 * `board`, `anchor` and `anchorFallback` are all in the board's own UNSCALED
 * coordinates, and `keepVisible` picks the first of the three that fits, per
 * axis: the board wherever it still fits, otherwise the selected tiles with
 * their chrome, otherwise the tiles alone. A seller who opens a panel from a
 * block is asking about THAT block, and on a phone (where a sheet takes over
 * half the screen) revealing the whole board is impossible while revealing the
 * one tile usually is not.
 */
export function reanchorPan({
  pan,
  zoom,
  previous,
  previousInsets,
  workspace,
  insets,
  board,
  anchor,
  anchorFallback,
}: {
  pan: { x: number; y: number };
  zoom: number;
  /** The workspace box as it was BEFORE the panel changed. */
  previous: Box;
  /** And the cover over it as it was, which says what the seller could see. */
  previousInsets: Insets;
  /** The workspace as it is now. */
  workspace: Box;
  insets: Insets;
  /** The board's full extent, preferred wherever it still fits. */
  board: Box;
  /** The blocks being worked on AND the controls hanging off them, used on any
   *  axis the board cannot fit. */
  anchor: Box;
  /** The same blocks without that chrome, for a strip too short to hold it.
   *  Defaults to `anchor`, so a caller with only one box states only one. */
  anchorFallback?: Box;
}): { hold: { x: number; y: number }; pan: { x: number; y: number } } {
  // 1. HOLD STILL. The pan is measured from the workspace's top-left corner,
  //    so undoing that corner's move is exactly what keeps the board on the
  //    same pixels of the screen. A panel that only resized the workspace (the
  //    right-hand column) moves the corner by nothing and lands here as a
  //    no-op, and a panel that floats OVER the canvas (the colour layer, every
  //    bottom sheet) never touches the box at all, so it does too.
  const hold = {
    x: pan.x + (previous.left - workspace.left),
    y: pan.y + (previous.top - workspace.top),
  };
  let x = hold.x;
  let y = hold.y;

  // 2. RECOVER. Now, with the board back where the seller left it, ask whether
  //    the panel is actually standing on it.
  const wasX = safeSpan(previous.width, previousInsets.left, previousInsets.right);
  const wasY = safeSpan(previous.height, previousInsets.top, previousInsets.bottom);
  const nowX = safeSpan(workspace.width, insets.left, insets.right);
  const nowY = safeSpan(workspace.height, insets.top, insets.bottom);
  const bare = anchorFallback ?? anchor;
  const keepX = keepVisible(
    nowX,
    { start: board.left * zoom, size: board.width * zoom },
    { start: anchor.left * zoom, size: anchor.width * zoom },
    { start: bare.left * zoom, size: bare.width * zoom },
  );
  const keepY = keepVisible(
    nowY,
    { start: board.top * zoom, size: board.height * zoom },
    { start: anchor.top * zoom, size: anchor.height * zoom },
    { start: bare.top * zoom, size: bare.height * zoom },
  );
  x += recover(
    x + keepX.start,
    keepX.size,
    takenFrom(previous.left, wasX, workspace.left, nowX),
    nowX,
  );
  y += recover(
    y + keepY.start,
    keepY.size,
    takenFrom(previous.top, wasY, workspace.top, nowY),
    nowY,
  );
  return { hold, pan: { x, y } };
}

/**
 * The pan that brings the blocks a seller has just SELECTED into the open.
 *
 * The rules above are about panels: they fire when the workspace box or the
 * cover over it changes, and they deliberately ignore the selection in its own
 * right, because a board that jumped every time a block was clicked would be
 * unusable. That leaves one gap, and on a phone it is a wide one — the cover
 * can stay exactly the same size while what is UNDER it changes completely:
 *
 *   - inserting from the library sheet selects the new block, which lands
 *     wherever the board had room, routinely under the sheet the seller is
 *     still holding open;
 *   - closing one full-width sheet and opening another of the same height
 *     (library out, inspector in) swaps the cover for an identical one, so
 *     `insetsEqual` sees no change at all and nothing re-anchors.
 *
 * In both cases the seller has just said which block they mean and the board
 * answers by not showing it.
 *
 * MINIMAL, AND ONLY WHEN IT HAS TO. `slideIntoView` returns zero for a
 * selection already inside the uncovered strip, so selecting something you can
 * already see moves nothing, which is every selection on a desktop. There is
 * no `taken` guard here and there should not be: that guard exists to stop a
 * panel merely resizing from undoing a board the seller deliberately parked
 * half off-screen, and a selection is not an accident of layout — it is the
 * seller pointing at something and asking to see it.
 *
 * Same two candidates as the recover rule, for the same reason: with the
 * chrome if the strip can hold it, without if it cannot (see keepVisible).
 */
export function revealPan({
  pan,
  zoom,
  workspace,
  insets,
  anchor,
  anchorFallback,
}: {
  pan: { x: number; y: number };
  zoom: number;
  workspace: Box;
  insets: Insets;
  /** The selected blocks and the controls hanging off them. */
  anchor: Box;
  /** The same blocks without that chrome. Defaults to `anchor`. */
  anchorFallback?: Box;
}): { x: number; y: number } {
  const bare = anchorFallback ?? anchor;
  const spanX = safeSpan(workspace.width, insets.left, insets.right);
  const spanY = safeSpan(workspace.height, insets.top, insets.bottom);
  const keepX = keepVisible(
    spanX,
    { start: anchor.left * zoom, size: anchor.width * zoom },
    { start: bare.left * zoom, size: bare.width * zoom },
  );
  const keepY = keepVisible(
    spanY,
    { start: anchor.top * zoom, size: anchor.height * zoom },
    { start: bare.top * zoom, size: bare.height * zoom },
  );
  return {
    x: pan.x + slideIntoView(pan.x + keepX.start, keepX.size, ...spanX),
    y: pan.y + slideIntoView(pan.y + keepY.start, keepY.size, ...spanY),
  };
}
