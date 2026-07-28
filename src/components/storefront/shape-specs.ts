import type { ShapeKind } from "@/types/storefront";

/**
 * The shape library: one code-defined spec per ShapeKind, the single source of
 * truth for how a shape renders on a tile AND as a picker glyph.
 *
 * SECURITY: every value here is a literal written by us. Config data selects a
 * spec by its allowlisted KEY and never contributes a class name or a
 * clip-path string. Typing the map as Record<ShapeKind, ShapeSpec> makes it
 * exhaustive: adding a kind without a spec is a compile error.
 */
export type ShapeSpec = {
  label: string;
  /** Sizing + radius classes for the shape body on a tile. */
  className: string;
  /** Same, scaled down for the ~14px picker glyph. */
  glyphClassName: string;
  /**
   * Fixed polygon. When present the shape renders through the clipped path
   * (outer border layer + inset fill layer) instead of a CSS border, because
   * a clip-path would otherwise cut a real border in half.
   */
  clip?: string;
};

export const SHAPE_SPECS: Record<ShapeKind, ShapeSpec> = {
  square: {
    label: "Square",
    className: "size-full",
    glyphClassName: "size-3.5",
  },
  circle: {
    label: "Circle",
    className: "size-full rounded-full",
    glyphClassName: "size-3.5 rounded-full",
  },
  ring: {
    label: "Ring",
    className: "size-full rounded-full",
    glyphClassName: "size-3.5 rounded-full",
  },
  diamond: {
    label: "Diamond",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  },
  rounded: {
    label: "Rounded square",
    className: "size-full rounded-[22%]",
    glyphClassName: "size-3.5 rounded-[22%]",
  },
  pill: {
    label: "Pill",
    className: "h-1/2 w-full rounded-full",
    glyphClassName: "h-2 w-3.5 rounded-full",
  },
  half: {
    label: "Half circle",
    className: "h-1/2 w-full rounded-t-full",
    glyphClassName: "h-2 w-3.5 rounded-t-full",
  },
  quarter: {
    label: "Quarter circle",
    className: "size-full rounded-tl-full",
    glyphClassName: "size-3.5 rounded-tl-full",
  },
  bar: {
    label: "Bar",
    className: "h-1/4 w-full",
    glyphClassName: "h-1 w-3.5",
  },
  triangle: {
    label: "Triangle",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(50% 0%, 100% 100%, 0% 100%)",
  },
  wedge: {
    label: "Wedge",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(0% 0%, 0% 100%, 100% 100%)",
  },
  pentagon: {
    label: "Pentagon",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)",
  },
  hexagon: {
    label: "Hexagon",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
  },
  octagon: {
    label: "Octagon",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)",
  },
  star: {
    label: "Star",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
  },
  sparkle: {
    label: "Sparkle",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(50% 0%, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0% 50%, 39% 39%)",
  },
  cross: {
    label: "Cross",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(35% 0%, 65% 0%, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0% 65%, 0% 35%, 35% 35%)",
  },
  arrow: {
    label: "Arrow",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(0% 30%, 60% 30%, 60% 0%, 100% 50%, 60% 100%, 60% 70%, 0% 70%)",
  },
  chevron: {
    label: "Chevron",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(0% 0%, 50% 0%, 100% 50%, 50% 100%, 0% 100%, 50% 50%)",
  },
  trapezoid: {
    label: "Trapezoid",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)",
  },
  parallelogram: {
    label: "Parallelogram",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)",
  },
  burst: {
    label: "Burst",
    className: "size-full",
    glyphClassName: "size-3.5",
    clip: "polygon(50% 0%, 58% 22%, 79% 10%, 76% 33%, 98% 35%, 82% 50%, 98% 65%, 76% 67%, 79% 90%, 58% 78%, 50% 100%, 42% 78%, 21% 90%, 24% 67%, 2% 65%, 18% 50%, 2% 35%, 24% 33%, 21% 10%, 42% 22%)",
  },
};
