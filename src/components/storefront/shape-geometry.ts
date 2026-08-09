import {
  SHAPE_POINTS_MAX,
  SHAPE_POINTS_MIN,
  SHAPE_ROUNDNESS_MAX,
  type ShapeKind,
} from "@/types/storefront";

/**
 * Pure geometry for the polygon shape kinds: fixed vertex tables, parametric
 * star generation (adjustable point count), and corner rounding, all emitted
 * as SVG path data in a 100x100 box. ShapeTileContent stretches that box to
 * the tile (preserveAspectRatio "none"), so a wide triangle is simply wide.
 *
 * SECURITY: every path this module returns is computed from literals here
 * plus schema-bounded integers (roundness, points). No user string ever
 * reaches path data.
 */

/** One vertex in the 100x100 shape box. */
export type ShapePoint = readonly [number, number];

// Fixed polygons (the shapes' classic proportions, one table per kind).
const POLYGON_VERTICES: Partial<Record<ShapeKind, readonly ShapePoint[]>> = {
  diamond: [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ],
  triangle: [
    [50, 0],
    [100, 100],
    [0, 100],
  ],
  wedge: [
    [0, 0],
    [0, 100],
    [100, 100],
  ],
  pentagon: [
    [50, 0],
    [100, 38],
    [82, 100],
    [18, 100],
    [0, 38],
  ],
  hexagon: [
    [25, 0],
    [75, 0],
    [100, 50],
    [75, 100],
    [25, 100],
    [0, 50],
  ],
  octagon: [
    [30, 0],
    [70, 0],
    [100, 30],
    [100, 70],
    [70, 100],
    [30, 100],
    [0, 70],
    [0, 30],
  ],
  cross: [
    [35, 0],
    [65, 0],
    [65, 35],
    [100, 35],
    [100, 65],
    [65, 65],
    [65, 100],
    [35, 100],
    [35, 65],
    [0, 65],
    [0, 35],
    [35, 35],
  ],
  arrow: [
    [0, 30],
    [60, 30],
    [60, 0],
    [100, 50],
    [60, 100],
    [60, 70],
    [0, 70],
  ],
  chevron: [
    [0, 0],
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 100],
    [50, 50],
  ],
  trapezoid: [
    [20, 0],
    [80, 0],
    [100, 100],
    [0, 100],
  ],
  parallelogram: [
    [25, 0],
    [100, 0],
    [75, 100],
    [0, 100],
  ],
};

/** The star family: point count is adjustable; each kind keeps its classic
 *  silhouette through its default count and inner-radius ratio. */
export const STAR_DEFAULTS: Partial<
  Record<ShapeKind, { points: number; innerRatio: number }>
> = {
  star: { points: 5, innerRatio: 0.38 },
  sparkle: { points: 4, innerRatio: 0.31 },
  burst: { points: 10, innerRatio: 0.6 },
};

/** Kinds whose geometry this module generates (everything else renders as a
 *  CSS box in ShapeTileContent: square, circle, ring, rounded, pill, half,
 *  quarter, bar). */
export function isPathKind(kind: ShapeKind): boolean {
  return kind in POLYGON_VERTICES || kind in STAR_DEFAULTS;
}

/** Kinds with an adjustable point count. */
export function supportsPoints(kind: ShapeKind): boolean {
  return kind in STAR_DEFAULTS;
}

// Corner roundness applies to every generated polygon, plus the box kinds
// whose radius is not already fixed by construction (circle, ring, pill,
// half and quarter are all fully round by definition).
const ROUNDABLE_BOX_KINDS: readonly ShapeKind[] = ["square", "rounded", "bar"];

/** Kinds the corner-roundness control applies to. */
export function supportsRoundness(kind: ShapeKind): boolean {
  return isPathKind(kind) || ROUNDABLE_BOX_KINDS.includes(kind);
}

/** The roundness a block without an explicit value renders with: `rounded`
 *  is born rounded (its whole identity), everything else sharp. */
export function defaultRoundness(kind: ShapeKind): number {
  return kind === "rounded" ? 22 : 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Alternating outer/inner vertices of an n-pointed star in the 100x100 box,
 * first point straight up. Exported for tests; rendering goes via shapePath.
 */
export function starVertices(points: number, innerRatio: number): ShapePoint[] {
  const n = clampInt(points, SHAPE_POINTS_MIN, SHAPE_POINTS_MAX);
  const vertices: ShapePoint[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / n;
    const radius = i % 2 === 0 ? 50 : 50 * innerRatio;
    vertices.push([
      round2(50 + radius * Math.cos(angle)),
      round2(50 + radius * Math.sin(angle)),
    ]);
  }
  return vertices;
}

/**
 * SVG path for a polygon with optionally rounded corners. Each corner is cut
 * `roundness` units before the vertex (clamped to half of each adjacent
 * edge, so corners never overlap) and joined with a quadratic curve through
 * the vertex — which handles convex and concave corners alike, so it works
 * on stars and crosses as well as hexagons.
 */
export function roundedPolygonPath(
  vertices: readonly ShapePoint[],
  roundness: number,
): string {
  const r = clampInt(roundness, 0, SHAPE_ROUNDNESS_MAX);
  if (r === 0) {
    return `M${vertices.map(([x, y]) => `${x} ${y}`).join("L")}Z`;
  }

  const count = vertices.length;
  const segments: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const [px, py] = vertices[(i + count - 1) % count];
    const [vx, vy] = vertices[i];
    const [nx, ny] = vertices[(i + 1) % count];
    const inLen = Math.hypot(vx - px, vy - py);
    const outLen = Math.hypot(nx - vx, ny - vy);
    // Degenerate (repeated) vertices contribute nothing to round against.
    if (inLen === 0 || outLen === 0) continue;
    const tIn = Math.min(r, inLen / 2);
    const tOut = Math.min(r, outLen / 2);
    const ax = round2(vx + ((px - vx) / inLen) * tIn);
    const ay = round2(vy + ((py - vy) / inLen) * tIn);
    const bx = round2(vx + ((nx - vx) / outLen) * tOut);
    const by = round2(vy + ((ny - vy) / outLen) * tOut);
    segments.push(
      `${segments.length === 0 ? "M" : "L"}${ax} ${ay}Q${vx} ${vy} ${bx} ${by}`,
    );
  }
  return `${segments.join("")}Z`;
}

/**
 * The SVG path for a generated kind with the block's parameters applied, or
 * null for the CSS box kinds. Parameters are clamped here as well as in the
 * schema, so a bad value can never reach path math.
 */
export function shapePath(
  kind: ShapeKind,
  options: { points?: number; roundness?: number } = {},
): string | null {
  const roundness = options.roundness ?? defaultRoundness(kind);
  const star = STAR_DEFAULTS[kind];
  if (star) {
    return roundedPolygonPath(
      starVertices(options.points ?? star.points, star.innerRatio),
      roundness,
    );
  }
  const vertices = POLYGON_VERTICES[kind];
  return vertices ? roundedPolygonPath(vertices, roundness) : null;
}
