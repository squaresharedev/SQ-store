import type { CSSProperties } from "react";
import type { GradientFill, ShapeBlock } from "@/types/storefront";
import { gradientCss } from "@/lib/storefront/gradients";

/**
 * A SHAPE'S GRADIENT FILL (ShapeBlock.gradient), as ShapeTileContent paints
 * it in each of its three ways: a path's SVG gradient, a box's background, and
 * a ring's stroke. The CSS itself comes from lib/storefront/gradients, the one
 * place a GradientFill becomes CSS.
 *
 * Absent, or with a stop that fails the strict hex gate, there is no gradient
 * and the shape is painted in its solid `color` exactly as before.
 */
export function shapeGradient(block: ShapeBlock): { fill: GradientFill; css: string } | null {
  if (!block.gradient) return null;
  const css = gradientCss(block.gradient);
  return css ? { fill: block.gradient, css } : null;
}

/** A box kind's paint: the gradient, else the solid colour, else nothing (the
 *  caller's muted class stands in). */
export function boxPaint(color: string | null, gradientCss: string | null): CSSProperties {
  if (gradientCss) return { backgroundImage: gradientCss };
  return color ? { backgroundColor: color } : {};
}

/** Paints only where the mask layer is. */
const FULL_MASK = "linear-gradient(black, black)";

/**
 * A ring in a gradient. A border cannot take a gradient and keep its round
 * corners, so the gradient is the element's background under a clear border,
 * and a mask cuts the inside away: what is left is the ring, at the width the
 * border sets, curved exactly as the solid ring is.
 */
export function ringGradientStyle(gradientCss: string): CSSProperties {
  return {
    borderColor: "transparent",
    backgroundImage: gradientCss,
    backgroundOrigin: "border-box",
    mask: `${FULL_MASK} padding-box, ${FULL_MASK}`,
    maskComposite: "exclude",
    WebkitMaskComposite: "xor",
  };
}
