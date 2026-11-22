import type { CSSProperties } from "react";
import type { StorefrontTheme, Texture } from "@/types/storefront";

/**
 * PAPER TEXTURE (theme.texture): a fine grain over the board's background and
 * under its blocks, on buyers' pages and in the designer alike.
 *
 * Drawn in code, never fetched: an SVG noise filter (feTurbulence) inside a
 * data URI, laid as one more background layer ON TOP of whatever the
 * background already is (colour, gradient or photo). Being a background
 * layer is what keeps it under every block and every word without a single
 * new element, z-index or stacking context.
 *
 * Grey grain at a low opacity: it darkens a light board and lightens a dark
 * one by a few percent, which reads as paper on both and moves no ink across
 * a contrast line.
 */

/** How much the grain shows, per preset. */
const GRAIN_OPACITY: Record<Exclude<Texture, "none">, number> = { light: 0.06, strong: 0.13 };

/** The grain's tile, in CSS px: small enough to stay crisp, large enough
 *  that its repeat is not seen. */
export const TEXTURE_TILE_PX = 160;

/** The noise, as an SVG document: grey fractal noise, fully opaque, which the
 *  rect then lays down at the preset's opacity. Every value is a literal or a
 *  number from GRAIN_OPACITY; nothing from a config reaches it. */
function grainSvg(opacity: number): string {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${TEXTURE_TILE_PX}' height='${TEXTURE_TILE_PX}'>` +
    "<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/>" +
    "<feColorMatrix values='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1'/></filter>" +
    `<rect width='100%' height='100%' filter='url(#g)' opacity='${opacity}'/></svg>`
  );
}

/** The grain as one background layer, or null for none (absent included). */
export function textureLayer(texture: Texture | undefined): { image: string; size: string } | null {
  if (texture !== "light" && texture !== "strong") return null;
  return {
    image: `url("data:image/svg+xml,${encodeURIComponent(grainSvg(GRAIN_OPACITY[texture]))}")`,
    size: `${TEXTURE_TILE_PX}px ${TEXTURE_TILE_PX}px`,
  };
}

/**
 * A background style (resolveBackgroundStyle's) with the grain laid on top.
 * The background's own layer keeps its size, position and repeat; the grain
 * tiles from the corner. NO TEXTURE RETURNS THE STYLE ITSELF, untouched, so a
 * storefront without one renders exactly as it did.
 */
export function withTextureLayer(style: CSSProperties, texture: Texture | undefined): CSSProperties {
  const layer = textureLayer(texture);
  if (!layer) return style;
  const below = style.backgroundImage;
  return {
    ...style,
    backgroundImage: below ? `${layer.image}, ${below}` : layer.image,
    backgroundSize: below ? `${layer.size}, ${style.backgroundSize ?? "auto"}` : layer.size,
    ...(style.backgroundPosition ? { backgroundPosition: `0 0, ${style.backgroundPosition}` } : {}),
    ...(style.backgroundRepeat ? { backgroundRepeat: `repeat, ${style.backgroundRepeat}` } : {}),
  };
}

/** Set the grain. `none` DROPS the key (absent is none). */
export function withTexture(theme: StorefrontTheme, texture: Texture): StorefrontTheme {
  if (texture === "none") {
    if (!("texture" in theme)) return theme;
    const { texture: dropped, ...plain } = theme;
    void dropped;
    return plain;
  }
  return theme.texture === texture ? theme : { ...theme, texture };
}
