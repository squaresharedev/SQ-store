// Where a TURNED box sits on the board, in the same units the box is stated in.
//
// ONE RULE: turning a block never changes how many cells it takes, only which
// way round they are. A 1x3 bar turned a quarter turn covers 3x1. It does not
// grow, it does not shrink, and it does not move. Anything else makes rotating
// feel like resizing, which is the one thing a rotate control must never do.
//
// So the footprint is the block's own span, TRANSPOSED when the block is
// nearer a quarter turn than to level, and centred on the same point the block
// already turns about. Angles in between (a 20 degree tilt) paint a little
// outside that box, which is fine: blocks may overlap, so a corner crossing
// into a neighbour's cell costs nothing.
//
// Pure arithmetic with no imports on purpose. The storefront contract
// (types/storefront) is a server boundary and the grid (components/grid) is a
// presentation-agnostic client primitive; both need this, and neither may
// import the other. One implementation here is what keeps them from drifting
// into two subtly different ideas of where a turned block is.
//
// Angles are DEGREES clockwise, matching the config's `rotation` field and
// CSS's own `rotate` property.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Is this block nearer a quarter turn than to level?
 *
 * The whole question, because it is the only one that changes which cells the
 * block covers. Exactly 45 degrees rounds to the quarter turn, arbitrarily but
 * consistently: a square is unaffected either way, and an oblong at 45 degrees
 * is a diagonal whose cell coverage is a judgement call whichever way it goes.
 */
export function isTransposed(degrees: number): boolean {
  if (!Number.isFinite(degrees)) return false;
  return Math.abs(Math.round(degrees / 90)) % 2 === 1;
}

/** The span a `w` x `h` block covers once turned: the same two numbers, in the
 *  order the turn leaves them. */
export function orientedSpan(
  w: number,
  h: number,
  degrees: number,
): { w: number; h: number } {
  return isTransposed(degrees) ? { w: h, h: w } : { w, h };
}

// A block whose width and height differ in parity (a 1x2, say) has its centre
// on a half cell once it is stood on its end, so the conversion below cannot
// land on a whole cell honestly and rounds down.

/** -0 is what this hands back for a small negative, and it compares unequal to
 *  0 under Object.is. A coordinate has one zero. */
function zeroless(value: number): number {
  return value === 0 ? 0 : value;
}

function floorCell(value: number): number {
  return zeroless(Math.floor(value));
}

/**
 * Where a turned box PAINTS, before any rounding: its span the other way
 * round, centred on the point it turns about.
 *
 * Fractional by nature, and that is the whole point of naming it. Turning a
 * box about its own centre moves its corners by (w - h) / 2, so a box whose
 * two dimensions differ in parity lands on a half cell — which is exactly the
 * gap {@link footprintOffset} closes.
 */
function paintedOrigin(box: Box, degrees: number): { x: number; y: number } {
  const span = orientedSpan(box.w, box.h, degrees);
  return {
    x: box.x + box.w / 2 - span.w / 2,
    y: box.y + box.h / 2 - span.h / 2,
  };
}

/**
 * The cells a turned block covers: its span the other way round, about the
 * point it turns on.
 *
 * Placed from the CENTRE outwards rather than snapped edge by edge, so the
 * span is exactly the block's own and can never gain a cell to rounding.
 */
export function rotatedFootprint(box: Box, degrees = 0): Box {
  if (!isTransposed(degrees)) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const span = orientedSpan(box.w, box.h, degrees);
  const painted = paintedOrigin(box, degrees);
  return {
    x: floorCell(painted.x),
    y: floorCell(painted.y),
    w: span.w,
    h: span.h,
  };
}

/**
 * HOW FAR A TURNED BOX MISSES THE CELLS IT CLAIMS, in cells, and therefore how
 * far it has to be nudged to sit on them.
 *
 * A block is drawn turned about its own centre, so standing it on its side puts
 * its corners at `x + (w - h) / 2`. When `w - h` is odd that is a HALF cell,
 * and the block paints straddling the board's lines: not on the cells its own
 * footprint claims, and visibly offset from every level tile beside it. Growing
 * a square block by one cell is enough to fall into it, which is why "rotate
 * it, then resize it" is the way anyone finds this.
 *
 * No integer placement can fix it — the half cell is in the ROTATION, not in
 * the rect — so the correction is a paint-time nudge, and this is the number.
 * It closes onto {@link rotatedFootprint}, so a nudged block paints on exactly
 * the cells the board already believes it occupies: 0 or -0.5 per axis, never
 * more.
 *
 * WHEREVER THE FOOTPRINT IS TRANSPOSED, not only at an exact quarter turn. The
 * two have to agree across the whole range or they disagree by half a cell
 * everywhere except at 90 itself — which is worse than not correcting at all,
 * because it puts a half-cell jump at 89-to-90, the one angle a seller is
 * actually working at. There is exactly ONE discontinuity to spend, and
 * {@link isTransposed} has already spent it at 45 degrees, where the cells the
 * board reserves flip from one span to the other. Putting the paint's step on
 * that same line means the tile and the guides under it move together, and
 * nothing moves at 90.
 *
 * A tilt nearer level than to a quarter turn transposes nothing and is left
 * exactly where it is.
 */
export function footprintOffset(
  box: Box,
  degrees = 0,
): { x: number; y: number } {
  if (!isTransposed(degrees)) return { x: 0, y: 0 };
  const painted = paintedOrigin(box, degrees);
  return {
    x: zeroless(floorCell(painted.x) - painted.x),
    y: zeroless(floorCell(painted.y) - painted.y),
  };
}

// ON THE BOARD.
//
// A turned block's stored rect and its footprint share a centre, so whenever
// its two spans differ the stored rect sits off the footprint by up to half
// the difference. Against an edge, only one of them can be on the board: a 1x3
// bar lying across the TOP row stores a rect that starts a row above the board.
//
// Every gesture used to hold the STORED rect to the board, and that is exactly
// what stopped a turned bar reaching the top and bottom rows (and a turned 2x1
// the last column) while the ghost under the hand showed plainly that it fit.
//
// So the board is asked about PER AXIS, and along each one either rect will do:
//
//   - the FOOTPRINT on the board is what a seller sees and what a move aims
//     for, so every row and column a turned block visibly fits in is reachable;
//   - the STORED rect on the board keeps every board that was valid before
//     valid now, including a block turned against an edge with its corners
//     hanging past it (turning never moves a block; see rotatedFootprint).
//
// The SPAN always fits (w <= columns, h <= rows). A renderer lays the stored
// rect out on the board's own grid lines, and a span longer than the board has
// no lines to be laid out on.
//
// Whole cells only. For a whole-cell origin the footprint sits a fixed number
// of cells from the stored rect, which is what lets one pair of numbers
// describe every position along an axis.

/** A closed run of whole-cell values, `min` to `max` inclusive. */
export interface Reach {
  min: number;
  max: number;
}

function inside(start: number, span: number, size: number): boolean {
  return start >= 0 && start + span <= size;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** One axis of {@link boardLanding}: by the footprint wherever its span fits,
 *  by the stored rect only where the footprint is longer than the board. */
function axisLanding(
  start: number,
  span: number,
  coveredStart: number,
  coveredSpan: number,
  size: number,
): Reach {
  if (coveredSpan <= size) {
    const offset = coveredStart - start;
    return { min: zeroless(-offset), max: size - coveredSpan - offset };
  }
  return { min: 0, max: Math.max(0, size - span) };
}

/**
 * Every STORED origin at which a box lies on a `columns` x `rows` board, per
 * axis: where its footprint is wholly on the board, or, along an axis the
 * footprint is too long for, where its stored rect is.
 *
 * The positions a move aims for. For a level block (or any tilt nearer level)
 * the footprint IS the stored rect, so this is the familiar `0..columns - w`.
 */
export function boardLanding(
  box: Box,
  degrees: number,
  columns: number,
  rows: number,
): { x: Reach; y: Reach } {
  const covered = rotatedFootprint(box, degrees);
  return {
    x: axisLanding(box.x, box.w, covered.x, covered.w, columns),
    y: axisLanding(box.y, box.h, covered.y, covered.h, rows),
  };
}

/**
 * Is this box on a `columns` x `rows` board, tilt included?
 *
 * Its span fits, and along each axis its footprint or its stored rect lies
 * wholly inside. The rule a saved block is held to, and the one every
 * gesture's clamp lands on.
 */
export function isOnBoard(
  box: Box,
  degrees: number,
  columns: number,
  rows: number,
): boolean {
  if (box.w > columns || box.h > rows) return false;
  const covered = rotatedFootprint(box, degrees);
  return (
    (inside(box.x, box.w, columns) || inside(covered.x, covered.w, columns)) &&
    (inside(box.y, box.h, rows) || inside(covered.y, covered.h, rows))
  );
}

/**
 * How far a MOVE may carry a box, as a step from where it is now, per axis.
 *
 * The landing (see boardLanding), widened to include standing still. That
 * widening is the whole of a move's manners: a block already hanging past an
 * edge (one turned against it) is never shoved back against the hand dragging
 * it, never pulled along an axis the move did not travel, and still lands
 * wholly on the board the moment the hand brings it there.
 *
 * A STEP range rather than a position, so a group can intersect its members'
 * ranges and travel as one rigid body. Each range contains zero, so the
 * intersection always does too: a group can always at least stay put.
 */
export function moveReach(
  box: Box,
  degrees: number,
  columns: number,
  rows: number,
): { x: Reach; y: Reach } {
  const landing = boardLanding(box, degrees, columns, rows);
  const widen = (reach: Reach, start: number): Reach => ({
    min: zeroless(Math.min(0, reach.min - start)),
    max: zeroless(Math.max(0, reach.max - start)),
  });
  return { x: widen(landing.x, box.x), y: widen(landing.y, box.y) };
}

/** A step held inside a {@link moveReach} range. */
export function clampStep(step: number, reach: Reach): number {
  return zeroless(clampNumber(step, reach.min, reach.max));
}

/**
 * A box put on the board with no move to measure against: a resize's result,
 * or a block dropped at a spot that may not fit.
 *
 * The span is capped to the board first. Then each axis is left EXACTLY where
 * it is when either rect is already on the board along it (see isOnBoard), so
 * a resize never nudges a block that was fine; otherwise it goes to the
 * nearest position where one of them is, preferring the footprint on a tie,
 * since that is the one the seller can see.
 */
export function clampOntoBoard(
  box: Box,
  degrees: number,
  columns: number,
  rows: number,
): Box {
  const w = Math.min(box.w, columns);
  const h = Math.min(box.h, rows);
  const covered = rotatedFootprint({ x: box.x, y: box.y, w, h }, degrees);
  const axis = (
    start: number,
    span: number,
    coveredStart: number,
    coveredSpan: number,
    size: number,
  ): number => {
    if (inside(start, span, size) || inside(coveredStart, coveredSpan, size)) {
      return start;
    }
    const byStored = clampNumber(start, 0, size - span);
    if (coveredSpan > size) return byStored;
    const offset = coveredStart - start;
    const byFootprint = clampNumber(start, -offset, size - coveredSpan - offset);
    return Math.abs(byFootprint - start) <= Math.abs(byStored - start)
      ? byFootprint
      : byStored;
  };
  return {
    x: zeroless(axis(box.x, w, covered.x, covered.w, columns)),
    y: zeroless(axis(box.y, h, covered.y, covered.h, rows)),
    w,
    h,
  };
}
