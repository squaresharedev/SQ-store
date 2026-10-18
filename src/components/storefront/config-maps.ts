import type { CSSProperties } from "react";
import type { MessageKey } from "@/i18n/types";
import type { GridPlacement } from "@/components/grid/gridConstants";
import {
  contrastRatio,
  MIN_LEGIBLE_CONTRAST,
  mixHex,
  readableInkOn,
} from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import {
  PRICE_TAG_DEFAULT_BORDER,
  TITLE_SHADOW_DEFAULT_COLOR,
  PRICE_TAG_SIZE_MIN,
  DEFAULT_CHIP_SCALE,
  TILE_LABEL_AUTO_SCALE,
  TILE_TITLE_SIZE,
  TILE_TITLE_SIZE_MIN,
  TITLE_INSET_AUTO,
  blockCornerRadius,
  blockKey,
  type ChipScale,
  type PriceTagFont,
  type SpotRow,
  type StorefrontBlock,
  type StorefrontFont,
  type StorefrontTheme,
  type TextAlign,
  type TextVariant,
  type TileCover,
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

/** Message keys: resolve with `useTranslations()` at the render site. */
export const FONT_LABELS: Record<StorefrontFont, MessageKey> = {
  sans: "Storefront.fonts.sans",
  serif: "Storefront.fonts.serif",
  mono: "Storefront.fonts.mono",
  display: "Storefront.fonts.display",
  hand: "Storefront.fonts.hand",
  inter: "Storefront.fonts.inter",
  montserrat: "Storefront.fonts.montserrat",
  custom: "Storefront.fonts.custom",
};

// Corner roundness is numeric (theme.cornerRadius, px) and applied as an
// inline border-radius style on grid cells, so there is no enum -> class map
// for it: CSS clamps oversized radii into circles/pills.

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
 * cell). It PUBLISHES the radius as `--tile-radius` as well as applying it,
 * because the tile's own contents have to know how much of their corners the
 * clip has eaten — see {@link titleBandStyle}. Descendants inherit the
 * variable, so no renderer has to be handed the tile's span.
 */
export function tileClipStyle(radius: number, coverInset = 0): CSSProperties {
  return {
    borderRadius: `${radius}px`,
    "--tile-radius": `${radius}px`,
    // Read by BlockTile's face. Inset rounds by the radius LESS the inset, the
    // curve that runs parallel to the tile's own, and CSS clamps an oversized
    // one the same way it clamps the border-radius above.
    ...(coverInset > 0
      ? {
          "--tile-cover-clip": `inset(${coverInset}px round ${Math.max(0, radius - coverInset)}px)`,
        }
      : {}),
  } as CSSProperties;
}

/**
 * How far a covered block's face pulls in from the edge it shares with the
 * product on top of it, in px.
 *
 * An antialiased edge is about one device pixel wide, and the face only stays
 * hidden if its own soft edge lies wholly inside the product's solid one. Two
 * rather than one because the designer's zoom is a transform: at 50% a CSS px
 * is half a device pixel. Invisible either way while the product is on top,
 * and the inset is dropped the moment it is not (see blockTileClipStyle).
 */
export const TILE_COVER_INSET_PX = 2;

/**
 * The clip one block's cell wears, including what it borrows from a product
 * stacked on top of it (see tileCovers).
 *
 * A covered block is rounded at least as much as the ROUNDEST-cornered cover
 * would still hide, which is the least round of them: a sharp square under a
 * card rounded past the theme no longer shows its corners. It never gets
 * sharper than its own setting. Its face is also pulled in by
 * TILE_COVER_INSET_PX, which is what hides the rim matching corners leak.
 *
 * `gestureKeys` keeps that honest mid-gesture. Placements stay committed while
 * a tile is dragged, resized or turned, so a cover that is on its way
 * somewhere else is ignored until it lands; a cover moving WITH the block (one
 * group move carrying both) still covers it.
 */
export function blockTileClipStyle(
  theme: StorefrontTheme,
  block: StorefrontBlock,
  placement: Pick<GridPlacement, "w" | "h">,
  covers: readonly TileCover[] | undefined,
  gestureKeys?: ReadonlySet<string>,
): CSSProperties {
  const own = blockCornerRadius(theme, block);
  const moving = gestureKeys?.has(blockKey(block)) ?? false;
  let cover: number | null = null;
  for (const entry of covers ?? []) {
    if ((gestureKeys?.has(entry.key) ?? false) !== moving) continue;
    cover = cover === null ? entry.cornerRadius : Math.min(cover, entry.cornerRadius);
  }
  if (cover === null) return tileClipStyle(scaledCornerRadius(own, placement));
  return tileClipStyle(
    scaledCornerRadius(Math.max(own, cover), placement),
    TILE_COVER_INSET_PX,
  );
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
 * The `shadow` style's room to fade, per row: the gradient needs space beyond
 * the words to reach transparent. The gradient itself is inline (see
 * titleShadowStyle), because its color is the seller's.
 */
export const TITLE_BAND_SHADOW_CLASSES: Record<SpotRow, string> = {
  top: "pb-8",
  middle: "py-4",
  bottom: "pt-8",
};

/** The stored shade, gated on the way out: it lands in a style attribute. */
function titleShadowColor(color: string | undefined): string {
  const lower = (color ?? "").toLowerCase();
  return isStrictHexColor(lower) ? lower : TITLE_SHADOW_DEFAULT_COLOR;
}

/**
 * The `shadow` style's gradient, per row, tinted with the seller's color: it
 * always fades AWAY from the edge the words sit against, so the type keeps its
 * backing wherever the band is. The middle band has no edge to lean on, so it
 * fades out both ways. The alphas (70%, 35%, 55%) are the ones the black
 * gradient always used, so an unset color renders exactly as before.
 */
export function titleShadowStyle(
  row: SpotRow,
  color: string | undefined,
): CSSProperties {
  const hex = titleShadowColor(color);
  const clear = `${hex}00`;
  return {
    backgroundImage:
      row === "middle"
        ? `linear-gradient(to bottom, ${clear}, ${hex}8c, ${clear})`
        : `linear-gradient(to ${row === "top" ? "bottom" : "top"}, ${hex}b3, ${hex}59, ${clear})`,
  };
}

/** What the words on a `shadow` band print in: white on a dark shade, dark on
 *  a light one, so a seller picking a pale fade never loses the name in it. */
export function titleShadowInk(color: string | undefined): string {
  return readableInkOn(titleShadowColor(color));
}

/**
 * What a `shadow` band puts behind an unfilled price, for the legibility
 * floor: the shade lifted toward grey, since the gradient is only 70% opaque
 * over a photo. For the default black this is #3d3d3d, the value the check
 * always used.
 */
export function titleShadowBackdrop(color: string | undefined): string {
  return mixHex(titleShadowColor(color), "#cccccc", 0.3);
}

/**
 * Inline style driving the shared --grid-gap token (see .ss-grid in
 * globals.css). Set on a grid ancestor; the gap AND the square-cell row math
 * both consume it, so cells stay true squares at any gap. `gridGap` is the
 * schema-bounded integer from theme.gridGap, never raw user text.
 */
export function gridGapStyle(gridGap: number): CSSProperties {
  return { "--grid-gap": `${gridGap}px` } as CSSProperties;
}


// A block's size is always an explicit px value now (see textSizeStyle and
// TextTileContent's auto-fit sizing), so this only ever supplies the WEIGHT —
// a text-* class alongside it would fight the inline value it can't measure
// against.
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

export const PRICE_TAG_FONT_LABELS: Record<PriceTagFont, MessageKey> = {
  inter: "Storefront.fonts.sans",
  serif: "Storefront.fonts.serif",
  mono: "Storefront.fonts.mono",
};

/** The resolved price tag appearance a renderer works from — structural, so
 *  the app's CardStyle satisfies it without config-maps reaching back into
 *  the per-tile override model to say so. */
type PriceTagChip = {
  priceTagSize: number;
  /** The theme's chip scale (CHIP_SCALES). Absent grows with the tile. */
  chipScale?: ChipScale;
  priceTagBorderWidth: number;
  priceTagRadius: number;
  priceTagColor?: string;
  priceTagTextColor?: string;
  priceTagBorderColor?: string;
};

/** Rounded to hundredths: these numbers go straight into a CSS expression, and
 *  a full float there is noise in the inspector for a difference under a
 *  hundredth of a pixel. */
export function roundForCss(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The type size a tile label renders at: its authored size scaled by how big
 * this tile actually came out. See {@link TILE_LABEL_AUTO_SCALE} for why the
 * labels follow the tile at all.
 *
 * `cqmin` is the tile face's SHORTER side (ProductTileContent is the size
 * container), the same axis scaledCornerRadius scales roundness by, so a 3x1
 * bar is treated as the one-cell-tall thing it is rather than a wide tile. The
 * bounds are on the authored number rather than absolute, so raising Size
 * raises the whole range and the slider never stops doing anything; only the
 * floor is also absolute, because under `floorPx` type stops being readable.
 *
 * No container in scope (nothing renders a label outside a real tile today,
 * but cq units fall back to the viewport rather than failing) is why the clamp
 * matters here as well: the worst case is a label at `max` times its size, not
 * one sized off the whole window.
 *
 * `scale` "cell" (CHIP_SCALES) measures against ONE GRID CELL instead of the
 * tile, so every tile on the board gets the label a 1x1 tile would: the grid
 * hands its cell's side down as `--ss-cell` (globals.css). Outside a grid
 * `--ss-in-grid` is 0 and the tile's own size is used, as before.
 */
export function tileLabelSize(size: number, floorPx: number, scale: ChipScale = DEFAULT_CHIP_SCALE): string {
  const { referencePx, min, max } = TILE_LABEL_AUTO_SCALE;
  const floor = Math.max(floorPx, size * min);
  const tile = `${roundForCss((size * 100) / referencePx)}cqmin`;
  const preferred =
    scale === "cell"
      ? `calc(var(--ss-cell) * ${roundForCss(size / referencePx)} * var(--ss-in-grid) + ${tile} * (1 - var(--ss-in-grid)))`
      : tile;
  return `clamp(${roundForCss(floor)}px, ${preferred}, ${roundForCss(size * max)}px)`;
}

/**
 * The title band's own type size, scaled by the tile exactly as the price is.
 *
 * The band holds the two labels SIDE BY SIDE, so they cannot scale by
 * different rules: a price that grew with the block while the product's name
 * stayed at a flat 12px would tower over the thing it is priced against. One
 * scale for the band keeps their relationship fixed and lets the whole band
 * be proportional to the tile, which is the point.
 */
export function titleBandFontStyle(): CSSProperties {
  // Through a custom property, like the chip's own size, so the value is
  // readable back off the element: `font-size` is a property browsers (and
  // jsdom) VALIDATE, and a bare clamp() of container units is dropped whole by
  // anything that does not know the function, taking the scaling with it.
  return {
    "--band-font-size": tileLabelSize(TILE_TITLE_SIZE, TILE_TITLE_SIZE_MIN),
    fontSize: "var(--band-font-size)",
    lineHeight: 1.35,
  } as CSSProperties;
}

/**
 * Every pixel of the price tag chip, from the resolved card style. All of it
 * is inline rather than classes because each value is a schema-bounded number
 * or a strict hex, and because "what colour is the tag" then has ONE answer a
 * renderer, a picker and an agent can all read.
 *
 * The resolved size lands on `--tag-font-size` and everything else reads it
 * from there, so the padding (half the type horizontally, a quarter of it
 * vertically) still scales with the type when the type is itself a CSS
 * expression the browser resolves: one slider sizes the whole tag, on a tile
 * of any span.
 */
export function priceTagChipStyle(
  card: PriceTagChip,
  /** What the chip paints where the seller set nothing — see
   *  defaultPriceTagFill and the accent/shadow rule in ProductTileContent. */
  fallback: { fill: string; text: string },
  /**
   * The colour the price is actually read AGAINST, for the legibility floor
   * below. Usually the chip's own fill; the caller passes it separately
   * because a chip with no fill of its own is read against whatever it is
   * sitting on, which only the tile knows (see ProductTileContent).
   */
  backdrop: string,
): CSSProperties {
  const size = card.priceTagSize;
  const border = card.priceTagBorderWidth;
  return {
    "--tag-font-size": tileLabelSize(size, PRICE_TAG_SIZE_MIN, card.chipScale),
    fontSize: "var(--tag-font-size)",
    lineHeight: 1.25,
    paddingInline: "max(2px, calc(var(--tag-font-size) * 0.5))",
    paddingBlock: "max(1px, calc(var(--tag-font-size) * 0.25))",
    borderRadius: `${card.priceTagRadius}px`,
    backgroundColor: card.priceTagColor ?? fallback.fill,
    color: legiblePriceInk(card.priceTagTextColor ?? fallback.text, backdrop),
    // A zero-width border must emit NO border properties at all, or the chip
    // still reserves the style's layout box.
    ...(border > 0
      ? {
          borderWidth: `${border}px`,
          borderStyle: "solid",
          borderColor: card.priceTagBorderColor ?? PRICE_TAG_DEFAULT_BORDER,
        }
      : {}),
  } as CSSProperties;
}

/** The struck-through earlier price, as a share of the price's own type size. */
const PRICE_WAS_SCALE = 0.8;
/** The space between the earlier price and the price, in the price's type size. */
const PRICE_WAS_GAP = 0.4;
/** The widest a character of a price runs, as a share of its type size, in any
 *  of the three chip faces (mono is exactly 0.6; a digit in the others is
 *  narrower still). An upper bound on purpose: see priceTagWasStyle. */
const PRICE_CHAR_WIDTH = 0.65;
/** How much of a title band the two prices may take between them. The rest is
 *  the product's name, which gives way to the chip and would otherwise be
 *  squeezed out entirely. */
const PRICE_WAS_BAND_SHARE = 60;

/**
 * The earlier price a running sale strikes through, inside the chip and ahead
 * of the price: a step smaller and quieter than the price it stands beside,
 * sized and spaced from the chip's own `--tag-font-size` so the pair scales
 * with the tile as one.
 *
 * IT GIVES WAY WHEN THE TILE HAS NO ROOM FOR BOTH. Two prices are twice the
 * chip, and a chip wider than its tile is clipped by the cell, which on a
 * small tile cut the price a buyer actually pays (see legiblePriceInk: that is
 * the one thing a tile may never lose). So the earlier price is drawn only
 * where the whole chip fits: its type size is that test, written as a CSS
 * expression the browser resolves against the tile as it really came out. The
 * room is the tile's width (`cqw`: the face is the size container) less the
 * chip's own inset for a floated tag, or the band's share for one in the title
 * band; what the chip needs is counted from the characters it will print.
 * Where it does not fit the size resolves to zero, and the earlier price and
 * its gap (an `em` of that size) take up nothing: the tile shows the sale
 * price alone, which is always a price it may show.
 *
 * Through a custom property, like the chip's own size: see titleBandFontStyle.
 */
export function priceTagWasStyle(chip: {
  /** How many characters the earlier price and the price are printed in. */
  wasLength: number;
  nowLength: number;
  /** In the title band, or floated over the picture. */
  inBand: boolean;
  borderWidth: number;
  /** The sale chip's width, in the tag's type size (saleChipWidth), when it
   *  shares this row (see sharedRowRoom): the earlier price gives way to it,
   *  before it gives way to the price. */
  besideWidth?: number;
}): CSSProperties {
  const size = "var(--tag-font-size)";
  // In units of the chip's type size: both prices, the gap between them, and
  // the chip's horizontal padding (half the type on each side).
  const needed = roundForCss(
    (chip.wasLength * PRICE_WAS_SCALE + chip.nowLength) * PRICE_CHAR_WIDTH + PRICE_WAS_GAP + 1,
  );
  const room = chip.inBand
    ? `${PRICE_WAS_BAND_SHARE}cqw`
    : chip.besideWidth
      ? sharedRowRoom(chip.besideWidth)
      : "(100cqw - 2 * var(--tag-inset, 8px))";
  return {
    // Zero when there is no room, the earlier price's own size when there is:
    // the difference is scaled so far up that nothing in between is ever seen.
    "--tag-was-size": `clamp(0px, calc((${room} - ${size} * ${needed} - ${chip.borderWidth * 2}px) * 9999), calc(${size} * ${PRICE_WAS_SCALE}))`,
    fontSize: "var(--tag-was-size)",
    marginInlineEnd: `${roundForCss(PRICE_WAS_GAP / PRICE_WAS_SCALE)}em`,
    opacity: 0.7,
  } as CSSProperties;
}

/** What a price chip of `length` characters takes of its row, in units of
 *  the tag's type size: its words, and half the type of padding either side. */
export function chipWidth(length: number): number {
  return length * PRICE_CHAR_WIDTH + 1;
}

/**
 * The room one chip has in a row it shares with another `besideWidth` wide (in
 * the tag's type size): the tile's width less both edge insets, the gap
 * between the two (one more inset) and the other chip. A CSS length, for the
 * give-way rules of the struck price above and of the sale chip (SaleChip).
 */
export function sharedRowRoom(besideWidth: number): string {
  return `(100cqw - 3 * var(--tag-inset, 8px) - var(--tag-font-size) * ${roundForCss(besideWidth)})`;
}

/**
 * THE PRICE IS NEVER ALLOWED TO DISAPPEAR.
 *
 * A buyer who cannot see what something costs cannot buy it, so this is the
 * one thing on a tile that is not left to the sum of a seller's choices. Ink
 * that does not carry against what it is printed on is replaced with ink that
 * does, and everything else about the chip is left exactly as asked for.
 *
 * The floor is WCAG's large-text bar and no stricter (see
 * MIN_LEGIBLE_CONTRAST), so a deliberate low-contrast look survives untouched
 * and only a genuinely unreadable pairing is overridden. Those arise from more
 * than a bad colour pick: the tag's automatic ink and its automatic fill are
 * each resolved from the tag's PLACEMENT, so a tag in mid-air between two
 * placements — which is exactly what a drag is — could resolve white text onto
 * the white backing a floated tag wears and paint a blank chip over the
 * picture. That particular pairing is fixed at the source too (the tile
 * resolves both from the live placement now), but a rule this important should
 * not rest on every future caller getting the same thing right.
 */
function legiblePriceInk(ink: string, backdrop: string): string {
  return contrastRatio(ink, backdrop) >= MIN_LEGIBLE_CONTRAST
    ? ink
    : readableInkOn(backdrop);
}

export const TEXT_VARIANT_LABELS: Record<TextVariant, MessageKey> = {
  heading: "Storefront.textVariants.heading",
  subheading: "Storefront.textVariants.subheading",
  body: "Storefront.textVariants.body",
};

export const TEXT_ALIGN_CLASSES: Record<TextAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * A TILE'S FRAME: the box a block's face sits in, on the designer's canvas and
 * on the hosted storefront alike (BlockTile, StorefrontPageView). It fills its
 * cell exactly and inherits the cell's corner radius, so the card border
 * curves with the roundness setting instead of being sliced square by the
 * cell's clip. Product blocks are bordered cards; text, shape and image blocks
 * sit chrome-less, so the kinds never read as the same thing.
 */
export function tileFrameClass(block: Pick<StorefrontBlock, "type">): string {
  return cn(
    "relative h-full w-full rounded-[inherit]",
    block.type === "product" ? "border border-border bg-card" : "bg-transparent",
  );
}

/**
 * A TILE'S FACE: the layer inside the frame that clips ITSELF to the corner
 * radius (the cell deliberately does not), with contain:paint for the per-cell
 * paint isolation the grid used to provide. The clip-path is set only on a
 * block that sits under a product on the same cells (blockTileClipStyle); the
 * variable is unset everywhere else, which leaves no clip-path at all.
 */
export const TILE_FACE_CLASS =
  "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit] [contain:paint] [clip-path:var(--tile-cover-clip,none)]";
