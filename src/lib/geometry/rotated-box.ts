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
 * The cells a turned block covers: its span the other way round, about the
 * point it turns on.
 *
 * Placed from the CENTRE outwards rather than snapped edge by edge, so the
 * span is exactly the block's own and can never gain a cell to rounding.
 */
export function rotatedFootprint(box: Box, degrees = 0): Box {
  if (!isTransposed(degrees)) return { x: box.x, y: box.y, w: box.w, h: box.h };
  const span = orientedSpan(box.w, box.h, degrees);
  return {
    x: floorCell(box.x + box.w / 2 - span.w / 2),
    y: floorCell(box.y + box.h / 2 - span.h / 2),
    w: span.w,
    h: span.h,
  };
}
