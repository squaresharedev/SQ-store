import { describe, expect, it } from "vitest";
import {
  SHAPE_KINDS,
  SHAPE_POINTS_MAX,
  SHAPE_POINTS_MIN,
} from "@/types/storefront";
import {
  STAR_DEFAULTS,
  defaultRoundness,
  isPathKind,
  roundedPolygonPath,
  shapePath,
  starVertices,
  supportsPoints,
  supportsRoundness,
} from "@/components/storefront/shape-geometry";

/**
 * The shape geometry contract: generated SVG paths stay inside the 100x100
 * box, star point counts are honored and clamped, and corner rounding never
 * produces degenerate or out-of-range coordinates. This module is the ONLY
 * source of path data, so pinning it pins every polygon shape's rendering.
 */

const SQUARE = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
] as const;

/** Every number in a path, for range checks. */
function numbersIn(d: string): number[] {
  return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

describe("starVertices", () => {
  it("returns alternating outer/inner vertices, 2n of them, first point up", () => {
    const vertices = starVertices(5, 0.4);
    expect(vertices).toHaveLength(10);
    expect(vertices[0]).toEqual([50, 0]);
    // Outer vertices sit on radius 50, inner on 20.
    const radius = ([x, y]: readonly [number, number]) =>
      Math.hypot(x - 50, y - 50);
    vertices.forEach((v, i) => {
      expect(radius(v)).toBeCloseTo(i % 2 === 0 ? 50 : 20, 1);
    });
  });

  it("clamps the point count to the schema bounds", () => {
    expect(starVertices(1, 0.4)).toHaveLength(SHAPE_POINTS_MIN * 2);
    expect(starVertices(99, 0.4)).toHaveLength(SHAPE_POINTS_MAX * 2);
  });
});

describe("roundedPolygonPath", () => {
  it("emits straight lines only when roundness is zero", () => {
    const d = roundedPolygonPath(SQUARE, 0);
    expect(d).toBe("M0 0L100 0L100 100L0 100Z");
  });

  it("emits one quadratic corner per vertex when rounded", () => {
    const d = roundedPolygonPath(SQUARE, 10);
    expect(d.match(/Q/g)).toHaveLength(4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });

  it("clamps the cut to half of each edge, so corners never cross", () => {
    // 100-unit edges: a cut of 50 each side meets exactly at the midpoints;
    // any roundness past that must produce the same (finite, valid) path.
    const d = roundedPolygonPath(SQUARE, 50);
    expect(numbersIn(d).every((n) => Number.isFinite(n))).toBe(true);
    expect(d).toContain("50 0");
  });

  it("skips degenerate repeated vertices instead of dividing by zero", () => {
    const d = roundedPolygonPath(
      [
        [0, 0],
        [0, 0],
        [100, 0],
        [50, 100],
      ],
      10,
    );
    expect(numbersIn(d).every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("shapePath", () => {
  it("generates for every path kind and stays inside the 100x100 box", () => {
    for (const kind of SHAPE_KINDS) {
      const d = shapePath(kind, { roundness: 16 });
      if (!isPathKind(kind)) {
        expect(d, kind).toBeNull();
        continue;
      }
      expect(d, kind).toMatch(/^M.*Z$/);
      for (const n of numbersIn(d!)) {
        expect(n, `${kind}: ${n}`).toBeGreaterThanOrEqual(0);
        expect(n, `${kind}: ${n}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("star families honor their classic defaults", () => {
    for (const [kind, defaults] of Object.entries(STAR_DEFAULTS)) {
      const d = shapePath(kind as (typeof SHAPE_KINDS)[number])!;
      // Sharp default: 2n vertices = M + (2n-1) L segments.
      expect(d.match(/L/g), kind).toHaveLength(defaults!.points * 2 - 1);
    }
  });

  it("capability queries agree with the geometry tables", () => {
    expect(supportsPoints("star")).toBe(true);
    expect(supportsPoints("hexagon")).toBe(false);
    expect(supportsRoundness("hexagon")).toBe(true);
    expect(supportsRoundness("square")).toBe(true);
    expect(supportsRoundness("circle")).toBe(false);
    expect(supportsRoundness("pill")).toBe(false);
    expect(defaultRoundness("rounded")).toBe(22);
    expect(defaultRoundness("square")).toBe(0);
  });
});
