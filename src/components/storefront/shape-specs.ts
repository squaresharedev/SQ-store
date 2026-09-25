import type { ShapeKind } from "@/types/storefront";

/**
 * The shape library: one code-defined spec per ShapeKind, the single source
 * of truth for how the CSS-rendered kinds size themselves on
 * a tile. The polygon kinds (diamond, star, hexagon, ...) carry no classes
 * here: their geometry is generated as SVG path data in shape-geometry.ts,
 * and ShapeTileContent stretches that over the tile.
 *
 * SIZING: every shape fills its whole tile, edge to edge, and stretches with
 * it — a circle on a wide tile IS an oval (its `50%` radius resolves per
 * axis, which is what makes the ellipse), and a stretched polygon elongates
 * with the tile. Corner roundness for the box kinds is dynamic (cqmin of the
 * tile's shorter side, applied inline by ShapeTileContent), so a rounded
 * square stretched wide becomes a rounded RECTANGLE with uniform corners.
 *
 * SECURITY: every value here is a literal written by us. Config data selects
 * a spec by its allowlisted KEY and never contributes a class name.
 */
export type ShapeSpec = {
  /** Sizing + radius classes for the CSS-rendered kinds; absent for the
   *  path kinds (they render as one stretched SVG). */
  className?: string;
  /** Same, scaled down for the ~14px picker glyph; path kinds draw a mini
   *  SVG of their real geometry instead. */
  glyphClassName?: string;
};

export const SHAPE_SPECS: Record<ShapeKind, ShapeSpec> = {
  square: {
    className: "size-full",
    glyphClassName: "size-3.5",
  },
  circle: {
    className: "size-full rounded-[50%]",
    glyphClassName: "size-3.5 rounded-full",
  },
  ring: {
    className: "size-full rounded-[50%]",
    glyphClassName: "size-3.5 rounded-full",
  },
  diamond: {},
  rounded: {
    className: "size-full",
    glyphClassName: "size-3.5 rounded-[22%]",
  },
  pill: {
    className: "h-1/2 w-full rounded-full",
    glyphClassName: "h-2 w-3.5 rounded-full",
  },
  half: {
    className: "h-1/2 w-full rounded-t-full",
    glyphClassName: "h-2 w-3.5 rounded-t-full",
  },
  quarter: {
    className: "size-full rounded-tl-full",
    glyphClassName: "size-3.5 rounded-tl-full",
  },
  bar: {
    className: "h-1/4 w-full",
    glyphClassName: "h-1 w-3.5",
  },
  triangle: {},
  wedge: {},
  pentagon: {},
  hexagon: {},
  octagon: {},
  star: {},
  sparkle: {},
  cross: {},
  arrow: {},
  chevron: {},
  trapezoid: {},
  parallelogram: {},
  burst: {},
};

/**
 * The library as a seller browses it, in the left-hand panel.
 *
 * Grouped by what a shape IS rather than by how it renders: the boxes-and-
 * curves split matters to a designer picking one, while the CSS-vs-SVG split
 * that ShapeTileContent cares about is an implementation detail and cuts
 * across these groups. Every ShapeKind appears exactly once — the unit test
 * holds this to SHAPE_KINDS, so a kind added later cannot go unbrowsable.
 */
export const SHAPE_GROUPS: readonly {
  /** Its name is Storefront.shapes.group.<id>. */
  id: "basic" | "polygons" | "accents";
  kinds: readonly ShapeKind[];
}[] = [
  {
    id: "basic",
    kinds: ["square", "rounded", "circle", "ring", "pill", "bar", "half", "quarter"],
  },
  {
    id: "polygons",
    kinds: [
      "triangle",
      "wedge",
      "diamond",
      "pentagon",
      "hexagon",
      "octagon",
      "trapezoid",
      "parallelogram",
    ],
  },
  {
    id: "accents",
    kinds: ["star", "sparkle", "burst", "cross", "arrow", "chevron"],
  },
];

/**
 * The shapes the Element tool offers inline, without sending the seller to the
 * panel.
 *
 * TWO, and that is the point. The toolbar used to carry all 22, which
 * overflowed the bar and turned the library into a sideways-scrolling strip
 * nobody read past. The menu is now a single row — upload, the library, and
 * the two shapes anyone actually reaches for straight away. Everything else is
 * one click away under "All shapes", where it can be browsed properly.
 */
export const QUICK_SHAPE_KINDS: readonly ShapeKind[] = ["square", "circle"];
