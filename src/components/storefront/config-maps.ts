import type { CSSProperties } from "react";
import type { GridPlacement } from "@/components/grid/gridConstants";
import {
  PRICE_TAG_DEFAULT_BORDER,
  TITLE_INSET_AUTO,
  type PriceTagFont,
  type SpotRow,
  type StorefrontFont,
  type TextAlign,
  type TextVariant,
  type TileSpot,
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

/**
 * The clip one tile wears, applied by whoever owns the tile's box (the grid
 * cell, the carousel item). It PUBLISHES the radius as `--tile-radius` as well
 * as applying it, because the tile's own contents have to know how much of
 * their corners the clip has eaten — see {@link titleBandStyle}. Descendants
 * inherit the variable, so no renderer has to be handed the tile's span.
 */
export function tileClipStyle(radius: number): CSSProperties {
  return {
    borderRadius: `${radius}px`,
    "--tile-radius": `${radius}px`,
  } as CSSProperties;
}

// Tile spot -> absolute placement over the image area. Center spots translate
// back by half their own size so they sit on the exact axis. Edge offsets
// read the --tag-inset var (see priceTagInsetStyle) with an 8px fallback —
// the exact value every one of these rendered before the var existed — so
// the picker, the layout board and the drag layer (none of which set the
// var; they preview an abstract tile, not a real sized one) keep rendering
// exactly as they always have.
export const TILE_SPOT_CLASSES: Record<TileSpot, string> = {
  "top-left": "left-[var(--tag-inset,8px)] top-[var(--tag-inset,8px)]",
  "top-center": "top-[var(--tag-inset,8px)] left-1/2 -translate-x-1/2",
  "top-right": "right-[var(--tag-inset,8px)] top-[var(--tag-inset,8px)]",
  "middle-center": "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
  "bottom-left": "bottom-[var(--tag-inset,8px)] left-[var(--tag-inset,8px)]",
  "bottom-center": "bottom-[var(--tag-inset,8px)] left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-[var(--tag-inset,8px)] right-[var(--tag-inset,8px)]",
};

/**
 * The title band's horizontal padding.
 *
 * An explicit inset is the seller's own number. ABSENT is auto, and auto is
 * the answer to rounded tiles: a clipped corner eats into the band from the
 * side, so the text is pushed in by a share of the tile's own radius instead
 * of running into the curve.
 *
 * The whole thing is a CSS expression rather than a computed number because
 * only the browser knows the radius that MATTERS. `--tile-radius` (see
 * tileClipStyle) carries the configured radius scaled by the tile's span, but
 * CSS then clamps a border-radius at half the element's side — a 300px radius
 * on a 110px tile really curves at 55 — and padding for the unclamped figure
 * would push a small tile's own words out of existence. `50cqmin` is that
 * clamp, read off the tile itself (ProductTileContent is the size container),
 * so the two mins together give the curve as drawn. No variable in scope means
 * no clip, so the floor applies and the band renders flush, the way every
 * square tile always has.
 *
 * Same rule as {@link autoTitleInset}, which the control evaluates in JS —
 * without the clamp, which is fine for its job of saying where the slider
 * starts.
 */
export function titleBandStyle(inset: number | undefined): CSSProperties {
  const { min, max, ratio } = TITLE_INSET_AUTO;
  return {
    paddingInline:
      inset === undefined
        ? `clamp(${min}px, calc(min(var(--tile-radius, 0px), 50cqmin) * ${ratio}), ${max}px)`
        : `${inset}px`,
  };
}

/**
 * The floated price tag's corner/edge offset — the same auto-scaling rule as
 * {@link titleBandStyle}, applied through the --tag-inset var TILE_SPOT_CLASSES
 * reads. Absent is auto: a heavily rounded big tile pushes the chip in from
 * the arc instead of leaving it to sit in the corner the clip already ate.
 * Set only on the real, sized product tile (see ProductTileContent) — the
 * picker/board/drag-layer previews never set the var, so they keep using
 * TILE_SPOT_CLASSES's own 8px fallback.
 */
export function priceTagInsetStyle(inset: number | undefined): CSSProperties {
  const { min, max, ratio } = TITLE_INSET_AUTO;
  return {
    "--tag-inset":
      inset === undefined
        ? `clamp(${min}px, calc(min(var(--tile-radius, 0px), 50cqmin) * ${ratio}), ${max}px)`
        : `${inset}px`,
  } as CSSProperties;
}

/** Where an overlaid title band is pinned, per row. The middle band centers
 *  itself on the image's own axis. The band is always one line tall, so its
 *  own padding — not an alignment — is what puts the words on the edge. */
export const TITLE_BAND_ROW_CLASSES: Record<SpotRow, string> = {
  top: "top-0",
  middle: "top-1/2 -translate-y-1/2",
  bottom: "bottom-0",
};

/**
 * The `shadow` style's gradient, per row: it always fades AWAY from the edge
 * the words sit against, so the type keeps its dark backing wherever the band
 * is. The middle band has no edge to lean on, so it fades out both ways.
 */
export const TITLE_BAND_SHADOW_CLASSES: Record<SpotRow, string> = {
  top: "bg-gradient-to-b from-black/70 via-black/35 to-transparent pb-8",
  middle: "bg-gradient-to-b from-transparent via-black/55 to-transparent py-4",
  bottom: "bg-gradient-to-t from-black/70 via-black/35 to-transparent pt-8",
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
