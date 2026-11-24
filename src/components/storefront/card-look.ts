import type { CSSProperties } from "react";
import { contrastRatio, legibleInkOn, readableInkOn } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/predicates";
import type { PhotoEdge } from "@/types/product";
import {
  TITLE_SHADOW_DEFAULT_COLOR,
  type CardStyle,
  type PhotoShape,
} from "@/types/storefront";
import { cellLength, maskStyle, titleShadowBackdrop } from "./config-maps";

/**
 * THE CARD LOOK, DRAWN (Photo cards, editor upgrade): what a product card
 * paints itself in, from its resolved CardStyle and what was measured at its
 * photo's edge (lib/storefront/photo-edge). One resolution, read by every part
 * of the card, so the frame, the name strip, the buy row and the words on
 * them can never disagree about which colour the card is.
 *
 * THE ABSENT PATH IS `undefined` EVERYWHERE. A card with none of the new
 * fields resolves to no colours at all, and the face then draws the classes it
 * always drew (bg-muted, bg-card, text-foreground) with no inline style, so a
 * storefront saved before the card look draws exactly as it did.
 *
 * Also here: the photo shapes cards and image blocks share. (The shadow
 * presets every block kind shares live in config-maps, beside the cell clip
 * that applies them.) Raw colours are allowed in this file only as the token
 * definitions below.
 */

/** The surface every card had before cards could be coloured: the name
 *  strip's and the buy row's white (`bg-card`). */
export const LEGACY_CARD_SURFACE = "#ffffff";

/** The photo frame's grey (`bg-muted`, --muted in globals.css), as the hex the
 *  rules below need when a photo is blended into it. */
export const LEGACY_PHOTO_FRAME = "#f5f5f5";

/**
 * How dark a card may be and still take a blended photo, as its contrast with
 * white. Blending multiplies the photo into the card, so the product darkens
 * by the card's own shade: on a pale card that is invisible, on one darker
 * than about mid-grey the product comes out murky. Such a card never blends,
 * whatever the setting says, and its photo keeps its own white.
 */
export const BLEND_MAX_CONTRAST_WITH_WHITE = 1.9;

/** The overlay strip's see-through, as the hex alpha the old `bg-card/90`
 *  class had (90%). */
const OVERLAY_ALPHA = "e6";

/** Strict hex, lowercased, or nothing: every value here lands in a style. */
function gate(hex: string | undefined): string | undefined {
  const lower = hex?.toLowerCase();
  return lower !== undefined && isStrictHexColor(lower) ? lower : undefined;
}

export type CardPaint = {
  /** The photo frame's fill. Absent = the legacy `bg-muted` class. */
  frame?: string;
  /** The name strip's fill for a bar or an overlay. Absent = the legacy
   *  `bg-card` (`bg-card/90` on an overlay) class. */
  strip?: string;
  /** The strip's fill as an overlay wears it (90%). */
  overlayStrip?: string;
  /** The buy row's fill. Absent = the legacy `bg-card` class. */
  foot?: string;
  /** What an unfilled price and an outline or link buy button are read
   *  against: the strip, or the card's own white. */
  stripBackdrop: string;
  /** The name's ink on a bar or an overlay. Absent = the legacy
   *  `text-foreground` class. */
  ink?: string;
  /** Multiply the cover photo into the frame, so its white becomes the card. */
  blend: boolean;
  /** Multiply the second (hover) photo too. Only when blending is forced on:
   *  `auto` measured the cover, never the second photo. */
  blendHover: boolean;
  /** The `shadow` title's shade: the seller's (absent = the default black),
   *  or, over a photo whose edge is white, a pale one in the colour that edge
   *  is drawn in. A dark fade over a white photo is a muddy grey smudge with
   *  white words lost in it; a pale fade with dark words reads. */
  shade?: string;
  /** The name's ink on a `shadow` fade, when the seller chose one. Absent =
   *  the ink that reads on the shade (titleShadowInk). */
  shadeInk?: string;
};

/** Whether a card's surface is pale enough to blend a photo into. */
export function blendsInto(surface: string): boolean {
  return contrastRatio(surface, "#ffffff") <= BLEND_MAX_CONTRAST_WITH_WHITE;
}

/**
 * The card's paint. `photoEdge` is what is at the product photo's edges
 * (Product.photoEdge; absent = not measured, and then `auto` leaves the photo
 * alone).
 */
export function cardPaint(
  card: Pick<
    CardStyle,
    | "cardColor"
    | "whiteBlend"
    | "titleBarColor"
    | "titleTextColor"
    | "titleStyle"
    | "titleShadowColor"
    | "photoShape"
  >,
  photoEdge?: PhotoEdge,
): CardPaint {
  const cardColor = gate(card.cardColor);
  const shaped = card.photoShape !== undefined && card.photoShape !== "rectangle";
  // A shaped photo leaves some of its frame showing, and the card's white
  // reads as a card where the old grey reads as a gap.
  const frame = cardColor ?? (shaped ? LEGACY_CARD_SURFACE : undefined);
  const surface = frame ?? LEGACY_PHOTO_FRAME;
  const canBlend = blendsInto(surface);
  const blend =
    canBlend && (card.whiteBlend === "on" || (card.whiteBlend === "auto" && photoEdge === "white"));

  const strip = gate(card.titleBarColor) ?? cardColor;
  const stripBackdrop = strip ?? LEGACY_CARD_SURFACE;
  const ownInk = gate(card.titleTextColor);
  const ink = ownInk ? legibleInkOn(ownInk, stripBackdrop) : strip ? readableInkOn(strip) : undefined;

  let shade = gate(card.titleShadowColor);
  let shadeInk: string | undefined;
  if (card.titleStyle === "shadow") {
    const edge = photoEdge === "white" ? (blend ? surface : LEGACY_CARD_SURFACE) : undefined;
    if (edge && readableInkOn(shade ?? TITLE_SHADOW_DEFAULT_COLOR) === "#ffffff") shade = edge;
    // Read against the fade as it really lands on a photo (part opaque), the
    // same backdrop the price in this band is held to.
    if (ownInk) shadeInk = legibleInkOn(ownInk, titleShadowBackdrop(shade));
  }

  return {
    ...(frame ? { frame } : {}),
    ...(strip ? { strip, overlayStrip: `${strip}${OVERLAY_ALPHA}` } : {}),
    ...(cardColor ? { foot: cardColor } : {}),
    stripBackdrop,
    ...(ink ? { ink } : {}),
    blend,
    blendHover: canBlend && card.whiteBlend === "on",
    ...(shade ? { shade } : {}),
    ...(shadeInk ? { shadeInk } : {}),
  };
}

/** The class that multiplies a photo into what is behind it. */
export const PHOTO_BLEND_CLASS = "mix-blend-multiply";

// ── Photo shapes ──────────────────────────────────────────────────────────

/** How far a shaped photo on a card sits in from the card's edges, and how
 *  round a "rounded" one is: shares of the card's own shorter side (the tile
 *  face is the size container), so a hero and a 1x1 look alike. */
const CARD_PHOTO_MARGIN = "6cqmin";
const CARD_PHOTO_ROUNDING = "12cqmin";

/** How round a "rounded" image block is, per grid cell of its SHORTER span:
 *  a share of the block itself, like the card's, so a 3x3 picture is as
 *  rounded as a 1x1 and both clearly rounder than the theme's corners. An
 *  image block has no margin: the picture IS the block. */
const BLOCK_PHOTO_ROUNDING_CELLS = 0.18;

/** Past any side a box can have: the browser scales radii that do not fit
 *  back to the largest that do, which turns this into a semicircle. */
const ROUND_FULL = "9999px";

/**
 * A photo cut to a PhotoShape, as a clip on the picture itself (a clip-path or
 * a mask, never a change to its box): the picture keeps its size and its
 * crop, so framing still measures what it always did. Empty for no shape and
 * for `rectangle`, which is the card's own corners.
 *
 * `card` sets the photo in from the card's edges so it sits ON the card; an
 * image block fills its own box, and `span` is its shorter side in cells.
 */
export function photoShapeStyle(shape: PhotoShape | undefined, where: "card" | "block", span = 1): CSSProperties {
  if (shape === undefined || shape === "rectangle") return {};
  const margin = where === "card" ? CARD_PHOTO_MARGIN : "0px";
  const rounding =
    where === "card" ? CARD_PHOTO_ROUNDING : cellLength(Math.round(BLOCK_PHOTO_ROUNDING_CELLS * Math.max(1, span) * 100) / 100);
  switch (shape) {
    case "rounded":
      return { clipPath: `inset(${margin} round ${rounding})` };
    case "arch":
      return { clipPath: `inset(${margin} round ${ROUND_FULL} ${ROUND_FULL} 0 0)` };
    case "circle":
      // A true circle on any box: the gradient's closest side is half the
      // shorter one. Its last pixel fades, so the edge is antialiased.
      return maskStyle({
        image: `radial-gradient(circle closest-side, #000 calc(100% - ${margin} - 1px), transparent calc(100% - ${margin}))`,
      });
  }
}
