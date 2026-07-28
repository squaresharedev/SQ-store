import type { CSSProperties } from "react";
import { SIZE_SPANS, type GridSize } from "@/components/grid/gridConstants";
import type {
  PriceTagFloatPosition,
  StorefrontFont,
  TextAlign,
  TextVariant,
} from "@/types/storefront";

// Enum -> class lookups for rendering a StorefrontConfig. Config enums never
// touch class strings directly — everything goes through these fixed maps, so
// user data can only ever select from tokenized values.

export const FONT_CLASSES: Record<StorefrontFont, string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
  display: "font-display",
  hand: "font-hand",
};

// Corner roundness is numeric (theme.cornerRadius, px) and applied as an
// inline border-radius style on grid cells / carousel tiles, so there is no
// enum -> class map for it: CSS clamps oversized radii into circles/pills.

/**
 * Radius for one tile: the theme's base roundness scaled by the tile's
 * SHORTER span, so multi-cell tiles keep the same relative roundness as 1x1
 * tiles and reach a full circle/pill at the slider's max (CSS clamps any
 * radius past half the short side). A 3x3 at base 100 gets 300px; a 2x1 gets
 * 100px, which is already past half its 1-cell height.
 */
export function scaledCornerRadius(
  cornerRadius: number,
  size: GridSize,
): number {
  const span = SIZE_SPANS[size];
  return cornerRadius * Math.min(span.colSpan, span.rowSpan);
}

// Floating price tag spot -> absolute placement over the image area. Center
// spots translate back by half their own size so they sit on the exact axis.
export const PRICE_TAG_FLOAT_CLASSES: Record<PriceTagFloatPosition, string> = {
  "top-left": "left-2 top-2",
  "top-center": "left-1/2 top-2 -translate-x-1/2",
  "top-right": "right-2 top-2",
  "middle-center": "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "bottom-left": "bottom-2 left-2",
  "bottom-center": "bottom-2 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-2 right-2",
};

/**
 * Inline style driving the shared --grid-gap token (see .ss-grid in
 * globals.css). Set on a grid ancestor; the gap AND the square-cell row math
 * both consume it, so cells stay true squares at any gap. `gridGap` is the
 * schema-bounded integer from theme.gridGap, never raw user text.
 */
export function gridGapStyle(gridGap: number): CSSProperties {
  return { "--grid-gap": `${gridGap}px` } as CSSProperties;
}


export const TEXT_VARIANT_CLASSES: Record<TextVariant, string> = {
  heading: "text-xl font-semibold sm:text-2xl",
  subheading: "text-base font-medium",
  body: "text-sm",
};

export const TEXT_VARIANT_LABELS: Record<TextVariant, string> = {
  heading: "Heading",
  subheading: "Subheading",
  body: "Body text",
};

export const TEXT_ALIGN_CLASSES: Record<TextAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};
