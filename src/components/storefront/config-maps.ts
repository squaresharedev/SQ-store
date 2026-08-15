import type { CSSProperties } from "react";
import type { GridPlacement } from "@/components/grid/gridConstants";
import {
  PRICE_TAG_DEFAULT_BORDER,
  type PriceTagFloatPosition,
  type PriceTagFont,
  type StorefrontFont,
  type TextAlign,
  type TextVariant,
} from "@/types/storefront";

// Enum -> class lookups for rendering a StorefrontConfig. Config enums never
// touch class strings directly — everything goes through these fixed maps, so
// user data can only ever select from tokenized values.

// `custom` has no class of its own: an uploaded face is applied as an inline
// family instead (lib/theme/storefront-fonts). Empty here means "inherit", the
// same thing that module returns when there is no upload to resolve.
export const FONT_CLASSES: Record<StorefrontFont, string> = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
  display: "font-display",
  hand: "font-hand",
  inter: "font-inter",
  montserrat: "font-montserrat",
  custom: "",
};

export const FONT_LABELS: Record<StorefrontFont, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
  display: "Display",
  hand: "Handwritten",
  inter: "Inter",
  montserrat: "Montserrat",
  custom: "Uploaded font",
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
  placement: Pick<GridPlacement, "w" | "h">,
): number {
  return cornerRadius * Math.min(placement.w, placement.h);
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

// Split variant treatment for blocks with an explicit fontSize: the override
// replaces the variant's SIZE while the variant keeps supplying its weight.
export const TEXT_VARIANT_WEIGHT_CLASSES: Record<TextVariant, string> = {
  heading: "font-semibold",
  subheading: "font-medium",
  body: "font-normal",
};

/**
 * Inline style for a block's own font size. Free-form sizing has no class map
 * (the value is a schema-bounded integer, TEXT_SIZE_MIN..TEXT_SIZE_MAX) and
 * goes out as px, with a line height in ems so any size stays readable.
 */
export function textSizeStyle(px: number): CSSProperties {
  return { fontSize: `${px}px`, lineHeight: 1.25 };
}

// Price tag typeface. Its own three-entry map rather than a slice of
// FONT_CLASSES: a chip is read at 10px, where display and handwritten faces
// stop being legible, so those are not on offer here.
export const PRICE_TAG_FONT_CLASSES: Record<PriceTagFont, string> = {
  inter: "font-inter",
  serif: "font-serif",
  mono: "font-mono",
};

export const PRICE_TAG_FONT_LABELS: Record<PriceTagFont, string> = {
  inter: "Sans",
  serif: "Serif",
  mono: "Mono",
};

/** The resolved price tag appearance a renderer works from — structural, so
 *  the app's CardStyle satisfies it without config-maps reaching back into
 *  the per-tile override model to say so. */
type PriceTagChip = {
  priceTagSize: number;
  priceTagBorderWidth: number;
  priceTagRadius: number;
  priceTagColor?: string;
  priceTagTextColor?: string;
  priceTagBorderColor?: string;
};

/**
 * Every pixel of the price tag chip, from the resolved card style. All of it
 * is inline rather than classes because each value is a schema-bounded number
 * or a strict hex, and because "what colour is the tag" then has ONE answer a
 * renderer, a picker and an agent can all read.
 *
 * Padding is derived from the size (half of it horizontally, a quarter
 * vertically, floored so an 8px tag still has a chip) rather than being its
 * own control: one slider scales the whole tag.
 */
export function priceTagChipStyle(
  card: PriceTagChip,
  /** What the chip paints where the seller set nothing — see
   *  defaultPriceTagFill and the accent/shadow rule in ProductTileContent. */
  fallback: { fill: string; text: string },
): CSSProperties {
  const size = card.priceTagSize;
  const border = card.priceTagBorderWidth;
  return {
    fontSize: `${size}px`,
    lineHeight: 1.25,
    paddingInline: `${Math.max(2, Math.round(size * 0.5))}px`,
    paddingBlock: `${Math.max(1, Math.round(size * 0.25))}px`,
    borderRadius: `${card.priceTagRadius}px`,
    backgroundColor: card.priceTagColor ?? fallback.fill,
    color: card.priceTagTextColor ?? fallback.text,
    // A zero-width border must emit NO border properties at all, or the chip
    // still reserves the style's layout box.
    ...(border > 0
      ? {
          borderWidth: `${border}px`,
          borderStyle: "solid",
          borderColor: card.priceTagBorderColor ?? PRICE_TAG_DEFAULT_BORDER,
        }
      : {}),
  };
}

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
