import type { CSSProperties } from "react";
import { LIGHT_INK } from "@/components/product-page/product-page-maps";
import type { CheckoutTexture } from "@/types/storefront";

// The ONLY place a checkout texture becomes CSS, in the spirit of
// components/storefront/background-presets.ts: the config stores a closed
// token (`checkoutPage.texture`), and this module turns it into known-safe
// background layers. The buyer's checkout, the thank-you page, the editor's
// artboards and the panel's swatches all paint through here, so a swatch
// cannot promise a pattern the page does not draw.
//
// Raw colour values are permitted in THIS file alone, like background-presets:
// these are the texture tokens, and each one is the page's own ink (the two
// inks of product-page-maps, never a third colour) at a few percent.

/** The two inks as rgb triplets, so each pattern can set its own alpha. */
const INK_RGB = { dark: "23,23,23", light: "255,255,255" } as const;

/**
 * How strongly each pattern is drawn, per ink. Light ink on a dark page needs a
 * touch more to read at all, and a pattern made of lines needs less than one
 * made of dots, because a line covers more of the page.
 */
const ALPHA: Record<CheckoutTexture, { dark: number; light: number }> = {
  paper: { dark: 0.55, light: 0.5 },
  dots: { dark: 0.16, light: 0.2 },
  grid: { dark: 0.06, light: 0.08 },
  lines: { dark: 0.06, light: 0.08 },
  linen: { dark: 0.035, light: 0.05 },
};

/** Pattern tiles, in px. */
const DOT_PITCH = 16;
const GRID_PITCH = 24;
const LINE_PITCH = 9;
const LINEN_PITCH = 3;
const PAPER_TILE = 180;

function rgba(ink: string, alpha: number): string {
  return `rgba(${ink === LIGHT_INK ? INK_RGB.light : INK_RGB.dark},${Math.min(alpha, 1)})`;
}

/**
 * Paper grain: fractal noise in the page's ink, thresholded so only the
 * highest speckles show. An SVG filter rather than a bitmap, so it is a few
 * hundred bytes of text, identical on server and client, and allowed by the
 * CSP's `img-src data:`. `strength` scales the alpha the threshold leaves.
 */
function paperGrain(ink: string, strength: number): string {
  const [r, g, b] = (ink === LIGHT_INK ? INK_RGB.light : INK_RGB.dark)
    .split(",")
    .map((channel) => (Number(channel) / 255).toFixed(3));
  const gain = Math.min(strength, 1.6).toFixed(3);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${PAPER_TILE}' height='${PAPER_TILE}'>` +
    `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${gain} -${(Number(gain) * 0.42).toFixed(3)}'/></filter>` +
    `<rect width='100%' height='100%' filter='url(#g)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * How a swatch draws a texture: stronger and tighter than the page. A pattern
 * drawn for a whole page at four percent on a 16px pitch shows two faint dots
 * in a 40px tile, and a swatch that shows nothing does not show the property.
 */
export const TEXTURE_SWATCH_LOOK = { emphasis: 2.5, scale: 0.5 } as const;

/**
 * The background layers for a texture over a solid surface, in the ink that
 * reads on that surface. Absent texture = no layers at all (a plain page).
 *
 * `look` is for the editor's swatches only (TEXTURE_SWATCH_LOOK): `emphasis`
 * multiplies the alpha and `scale` the pattern's pitch. A page never passes it.
 */
export function textureLayers(
  texture: CheckoutTexture | undefined,
  ink: string,
  look: { emphasis?: number; scale?: number } = {},
): CSSProperties {
  if (!texture) return {};
  const { emphasis = 1, scale = 1 } = look;
  const alpha = (ink === LIGHT_INK ? ALPHA[texture].light : ALPHA[texture].dark) * emphasis;
  const color = rgba(ink, alpha);
  const px = (pitch: number) => `${Math.max(pitch * scale, 2)}px`;
  switch (texture) {
    case "paper":
      return {
        backgroundImage: paperGrain(ink, alpha),
        backgroundSize: `${px(PAPER_TILE)} ${px(PAPER_TILE)}`,
      };
    case "dots":
      return {
        backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1.6px)`,
        backgroundSize: `${px(DOT_PITCH)} ${px(DOT_PITCH)}`,
      };
    case "grid":
      return {
        backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
        backgroundSize: `${px(GRID_PITCH)} ${px(GRID_PITCH)}`,
      };
    case "lines":
      return {
        backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px ${px(LINE_PITCH)})`,
      };
    case "linen":
      return {
        backgroundImage: `repeating-linear-gradient(0deg, ${color} 0 1px, transparent 1px ${px(LINEN_PITCH)}), repeating-linear-gradient(90deg, ${color} 0 1px, transparent 1px ${px(LINEN_PITCH)})`,
      };
  }
}
