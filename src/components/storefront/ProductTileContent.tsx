"use client";

import type { CSSProperties, RefObject } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { Product } from "@/types/product";
import {
  defaultPriceTagFill,
  resolveCardStyle,
  resolvePriceTagPosition,
  resolveTitlePosition,
  spotColumn,
  spotRow,
  titleBandRow,
  titleOverlaysImage,
  type CardStyleOverrides,
  type ImagePlacement,
  type PriceTagFloatPosition,
  type SpotRow,
  type StorefrontTheme,
} from "@/types/storefront";
import { priceTagAutoTextColor } from "@/lib/theme/color-target";
import { imageStyle } from "@/lib/images/placement";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PRICE_TAG_FONT_CLASSES,
  TEXT_ALIGN_CLASSES,
  TILE_SPOT_CLASSES,
  TITLE_BAND_ROW_CLASSES,
  TITLE_BAND_SHADOW_CLASSES,
  priceTagChipStyle,
  priceTagInsetStyle,
  titleBandStyle,
} from "./config-maps";
import {
  tileSpotTokenLabel,
  tileSpotTokenProps,
  type TileSpotDrag,
} from "./TileSpotDragLayer";

// Reveal-on-hover also reveals on keyboard focus within the tile; with
// reduced motion the change is instant instead of faded.
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-base ease-standard group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none";

// Slide-in reveal for the overlay title bar: it rises from the tile's bottom
// edge, or drops from the top one, on hover/focus (the grid cell clips the
// off-canvas start position). A middle band has no edge to come from and its
// own transform already centers it, so that row fades instead.
const HOVER_RISE_CLASSES: Record<SpotRow, string> = {
  top: "-translate-y-full opacity-0 transition-[transform,opacity] duration-base ease-standard group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-reduce:transition-none",
  middle: HOVER_REVEAL_CLASS,
  bottom:
    "translate-y-full opacity-0 transition-[transform,opacity] duration-base ease-standard group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-reduce:transition-none",
};

/** Duration override for the hover reveal, as an inline style: the resolved
 *  ms value (theme.titleHoverMs / priceHoverMs, per-tile overridable) wins
 *  over the `duration-base` utility baked into HOVER_REVEAL_CLASS /
 *  HOVER_RISE_CLASSES, without needing a Tailwind class per possible value. */
function hoverDurationStyle(ms: number): CSSProperties {
  return { transitionDuration: `${ms}ms` };
}

/**
 * The product face of a grid tile. Card appearance comes from ONE resolved
 * CardStyle (the theme's card settings with the block's own overrides laid on
 * top, see resolveCardStyle), so a tile styled individually renders through
 * exactly the same logic as one following the theme. The title area renders
 * per titleStyle: `bar` = solid bar under the image, `overlay` = translucent
 * bar over the image bottom, `shadow` = text over a bottom gradient shadow on
 * the image. titleDisplay shows the area always or only on hover/focus; on
 * reveal the overlay bar slides up from the bottom edge, the others fade.
 * priceDisplay independently shows the price always or only on hover/focus.
 *
 * titlePosition places the band on the SAME seven-spot board the price tag
 * uses: the row (top/middle/bottom) says where the band sits — above or below
 * the picture for `bar`, pinned inside it for the overlaid styles — and the
 * column says which way the words pull. resolveTitlePosition is what the
 * renderer and the picker both call, so a bar never claims a middle it cannot
 * have and a rounded tile never puts type in a clipped corner. The band's
 * horizontal breathing room follows the tile's roundness on its own unless the
 * seller sets titleInset (see titleBandStyle).
 *
 * priceTagPosition controls placement: in the title band (`below`), at one of
 * the floating spots (4 corners + center vertical axis), or `hidden`; the
 * spot actually used comes from resolvePriceTagPosition, which pushes a tag
 * off whichever row an overlay/shadow title holds, so the price and the
 * product name can never share the same corner. The chip's own appearance
 * (font, size, fill, text, border, roundness) is a set of bounded fields
 * rendered by priceTagChipStyle. A block the seller marked sold out dims its
 * image and (per theme.soldOutBadge) wears a corner badge, which steps to the
 * opposite edge rather than hiding under an overlaid title. Accent and the
 * sold-out badge stay theme-wide by design.
 */
export function ProductTileContent({
  product,
  theme,
  overrides,
  soldOut = false,
  imagePlacement,
  imageRef,
  spotDrag,
}: {
  product: Product;
  theme: StorefrontTheme;
  /** The block's per-tile style overrides (block.style), if any. */
  overrides?: CardStyleOverrides;
  soldOut?: boolean;
  /** Where the photo sits in this tile's frame. Absent = centred at cover,
   *  which renders with no inline style at all. */
  imagePlacement?: ImagePlacement;
  /** Handed to the framing overlay so it can read the picture's intrinsic
   *  size, which is what makes a drag track the pointer exactly. */
  imageRef?: RefObject<HTMLImageElement | null>;
  /** Editor only: arms the title and price as draggable tokens. Absent on
   *  every read-only path (preview, card thumbnail, the buyer's page), which
   *  then renders with no handlers, no tab stops and no affordance. */
  spotDrag?: TileSpotDrag;
}) {
  const card = resolveCardStyle(theme, overrides);

  // A token in flight is drawn where it is GOING, not where it is stored: the
  // whole point of dragging the thing is watching it move. Nothing is written
  // until the drop, so a cancelled drag needs no restore.
  const flying = spotDrag?.active ?? null;
  const draggedTitle =
    flying?.token === "title" && flying.drop !== "below" ? flying.drop : null;
  const draggedPrice = flying?.token === "price" ? flying.drop : null;

  // Overlay + shadow render the title band over the image; bar is a row of its
  // own, above or below it.
  const overlaid = titleOverlaysImage(card.titleStyle);
  const shadowArea = card.titleStyle === "shadow";
  const titleHover = card.titleDisplay === "hover";

  // "hidden" position is the single hide switch (legacy priceDisplay "never"
  // is migrated to it by the schema).
  const priceHidden = card.priceTagPosition === "hidden";
  const pricePosition = draggedPrice ?? card.priceTagPosition;

  // Where the band really lands: a bar has no middle row, and heavy roundness
  // clips the corners off. Both are structural, so the picker resolves the
  // same way and shows the spot that renders.
  const titleSpot = resolveTitlePosition(draggedTitle ?? card.titlePosition, {
    titleStyle: card.titleStyle,
    cornerRadius: card.cornerRadius,
  });
  const titleRow = spotRow(titleSpot);

  // The two structural rules that can take a tag spot away: a heavy corner
  // radius clips the corners off, and an overlay/shadow title band occupies a
  // row of the image — the same box a floated tag sits in, so a tag sharing
  // that row moves to the opposite one rather than landing on the name. A band
  // the tile does not draw (showTitle off) reserves nothing, which titleBandRow
  // is what answers.
  const bandRow = titleBandRow({ ...card, titlePosition: titleSpot });
  const tagPosition = resolvePriceTagPosition(pricePosition, {
    cornerRadius: card.cornerRadius,
    titleBand: bandRow,
  });

  // What the chip paints where the seller chose nothing: the fill follows the
  // placement (a backing over a photo, none in the info bar), the text the
  // accent. Both resolvers are shared with the pickers, so the panel's "Auto"
  // dot always shows what the tile is really doing. An explicit color wins
  // over either, inside priceTagChipStyle.
  const chipStyle = priceTagChipStyle(card, {
    fill: defaultPriceTagFill(pricePosition),
    text: priceTagAutoTextColor(card, theme.accent),
  });
  const chipFontClass = PRICE_TAG_FONT_CLASSES[card.priceTagFont];

  // The token props are the only thing separating an editable tile from a
  // buyer's: absent, both spans render exactly as they always have.
  const priceToken =
    spotDrag?.price && !priceHidden && tagPosition !== "hidden"
      ? tileSpotTokenProps("price", spotDrag, tileSpotTokenLabel("price", tagPosition))
      : null;
  const titleToken =
    spotDrag?.title && card.showTitle
      ? tileSpotTokenProps("title", spotDrag, tileSpotTokenLabel("title", titleSpot))
      : null;

  // Every pixel of the chip is inline (see priceTagChipStyle); the classes
  // carry only placement, typeface and the hover reveal.
  const floatedPrice =
    !priceHidden && tagPosition !== "below" && tagPosition !== "hidden" ? (
      <span
        {...priceToken}
        className={cn(
          "absolute z-10",
          chipFontClass,
          TILE_SPOT_CLASSES[tagPosition as PriceTagFloatPosition],
          card.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
          priceToken?.className,
        )}
        style={{
          ...chipStyle,
          ...priceTagInsetStyle(card.priceTagInset),
          ...hoverDurationStyle(card.priceHoverMs),
        }}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Price in the title area, only when position is "below" and not hidden.
  const inlinePrice =
    !priceHidden && tagPosition === "below" ? (
      <span
        {...priceToken}
        className={cn(
          "shrink-0",
          chipFontClass,
          card.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
          priceToken?.className,
        )}
        style={{ ...chipStyle, ...hoverDurationStyle(card.priceHoverMs) }}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Title band: shown when the title is visible OR when the price sits below
  // (then it renders with just the price so the layout keeps its shape).
  // ONE band either way — "below" means "in the title band", so the price
  // follows the title's row instead of stranding a second bar somewhere else.
  const showTitleArea =
    card.showTitle || (!priceHidden && tagPosition === "below");

  const titleArea = showTitleArea ? (
    <div
      // How a price being dragged finds its way home: the band is the one drop
      // target that is not a spot on the board, so it has to be hit-testable.
      data-title-band=""
      // Horizontal padding is the one part of the band that is not a class:
      // on auto it reads the tile's own clip radius (see titleBandStyle).
      style={{
        ...titleBandStyle(card.titleInset),
        ...hoverDurationStyle(card.titleHoverMs),
      }}
      className={cn(
        "flex items-baseline justify-between gap-2 py-1.5",
        // A bar is a real row in the tile's column, so it needs no pinning.
        !overlaid && "bg-card",
        overlaid && "absolute inset-x-0 z-10",
        overlaid && TITLE_BAND_ROW_CLASSES[titleRow],
        card.titleStyle === "overlay" && "bg-card/90",
        // Shadow: no bar, a gradient fading away from the words for legibility.
        shadowArea && TITLE_BAND_SHADOW_CLASSES[titleRow],
        titleHover &&
          (card.titleStyle === "overlay"
            ? HOVER_RISE_CLASSES[titleRow]
            : HOVER_REVEAL_CLASS),
        // The band lights up while a price is hovering it, because `below` is
        // the one drop target with no dot of its own to fill.
        flying?.token === "price" &&
          flying.drop === "below" &&
          "ring-2 ring-inset ring-primary",
      )}
    >
      {card.showTitle && (
        <span
          {...titleToken}
          className={cn(
            // min-w-0 states what `truncate`'s overflow already implies: the
            // title yields to the price rather than pushing it out of the row.
            // With the price shrink-0 beside it, the two cannot overlap; flex-1
            // is what lets the spot's column steer the words inside that space.
            "min-w-0 flex-1 truncate text-xs font-medium",
            TEXT_ALIGN_CLASSES[spotColumn(titleSpot)],
            shadowArea ? "text-white drop-shadow-sm" : "text-foreground",
            titleToken?.className,
          )}
        >
          {product.title}
        </span>
      )}
      {inlinePrice}
    </div>
  ) : null;

  // A `bar` title at the top is a row ABOVE the picture — the only placement
  // that changes the tile's own column order rather than pinning a band.
  const barAbove = !overlaid && titleRow === "top";

  return (
    // Corner clipping comes from the grid cell (border-radius +
    // overflow-hidden per the resolved cornerRadius); the face needs no
    // clip of its own. It IS the size container the title band measures the
    // clip against, though (see titleBandStyle): the browser clamps a radius
    // at half the tile's side, and cq units are the only way to say "half the
    // tile" from in here. The face is stretched by its parent, so containment
    // costs it nothing.
    <div className="relative flex min-h-0 flex-1 flex-col [container-type:size]">
      {barAbove && titleArea}
      <div
        // THE BOX THE PHOTO IS ACTUALLY CROPPED TO, and the reason it is
        // marked rather than inferred. A `bar` title is a row of the tile's
        // own column, so the picture's frame is SHORTER than the tile by
        // exactly that band — and everything that reasons about the crop from
        // outside the face (the framing surface, the dimmed copy of the rest
        // of the picture) has to measure this box, not the tile, or it draws
        // the overflow at the wrong scale. See frameElement in
        // TileImageFramer.
        data-image-frame=""
        className="relative min-h-0 flex-1 bg-muted"
      >
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img
            ref={imageRef}
            src={product.imageUrl}
            alt=""
            // Images are natively draggable, which hijacks a tile drag on the
            // canvas and shows a not-allowed cursor.
            draggable={false}
            // Empty for an unframed tile, so the overwhelmingly common case
            // carries no inline style and renders exactly as it always has.
            style={imageStyle(imagePlacement)}
            className={cn(
              "size-full object-cover",
              soldOut && "opacity-60 grayscale",
            )}
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageIcon
              className="size-6 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>
        )}
        {/* Floating price tag, placed over the image per the chosen spot. */}
        {floatedPrice}
        {soldOut && theme.soldOutBadge && (
          <span
            className={cn(
              "absolute left-2 z-10 rounded-sm bg-primary px-1.5 py-0.5 font-inter text-xs font-medium text-primary-foreground",
              // An overlaid title at the top would paint straight over the
              // badge (a full-width band, not a chip it could sit beside), so
              // the badge takes the far edge instead.
              overlaid && titleRow === "top" ? "bottom-2" : "top-2",
            )}
          >
            Sold out
          </span>
        )}
      </div>
      {!barAbove && titleArea}
    </div>
  );
}
