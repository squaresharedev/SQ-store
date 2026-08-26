// Pure geometry for the grid's rotate gesture and for hit-testing a tilted
// cell. Kept out of Grid.tsx so it can be unit-tested without a DOM, and kept
// presentation-agnostic like the rest of components/grid: nothing here knows
// what a storefront block is.
//
// Angles are DEGREES, clockwise, matching the config's `rotation` field and
// CSS's own `rotate` property. Screen coordinates are y-down, which is why the
// clockwise direction below reads as a plus rather than a minus.

export interface Point {
  x: number;
  y: number;
}

/** The detent a rotate drag snaps to while Shift is held. 15 is what Sketch,
 *  Figma and Illustrator all use, so it is what a seller will expect. */
export const ROTATION_SNAP_STEP = 15;

const DEG = 180 / Math.PI;

/**
 * The angle from a centre to a point, clockwise from 12 o'clock.
 *
 * Measured from straight up rather than from the x-axis because that is the
 * direction a rotate handle is dragged around, so the delta between two calls
 * IS the angle the wrist turned through.
 */
export function angleFromCenter(center: Point, point: Point): number {
  return Math.atan2(point.x - center.x, center.y - point.y) * DEG;
}

/**
 * Fold any angle into (-180, 180] as a whole degree.
 *
 * Deliberately mirrored by `normalizeRotation` in types/storefront, for the
 * same reason `placementsOverlap` is duplicated there: the config type is a
 * server boundary and must not import a client component module to share three
 * lines of arithmetic.
 */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((Math.round(degrees) % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Snap to the nearest multiple of `step`. */
export function snapAngle(degrees: number, step: number): number {
  if (step <= 0) return degrees;
  return Math.round(degrees / step) * step;
}

/**
 * A point mapped back into an element's own unrotated space, about its centre.
 *
 * This is what makes edge hit-testing work on a tilted cell: the element's
 * layout box never moves, only its paint does, so un-rotating the pointer lets
 * every existing box comparison stay exactly as it was.
 */
export function toLocalPoint(center: Point, degrees: number, point: Point): Point {
  if (degrees === 0) return point;
  // Inverse of a clockwise screen-space rotation.
  const radians = (-degrees / DEG);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}
