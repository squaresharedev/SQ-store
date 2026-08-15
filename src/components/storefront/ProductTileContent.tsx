"use client";

import type { RefObject } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { Product } from "@/types/product";
import {
  defaultPriceTagFill,
  resolveCardStyle,
  resolvePriceTagPosition,
  titleOverlaysImage,
  type CardStyleOverrides,
  type ImagePlacement,
  type PriceTagFloatPosition,
  type StorefrontTheme,
} from "@/types/storefront";
import { priceTagAutoTextColor } from "@/lib/theme/color-target";
import { imageStyle } from "@/lib/images/placement";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  PRICE_TAG_FLOAT_CLASSES,
  PRICE_TAG_FONT_CLASSES,
  priceTagChipStyle,
} from "./config-maps";

// Reveal-on-hover also reveals on keyboard focus within the tile; with
// reduced motion the change is instant instead of faded.
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-base ease-standard group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none";

// Slide-up reveal for the overlay title bar: it rises from the tile's bottom
// edge on hover/focus (the grid cell clips the off-canvas start position).
const HOVER_RISE_CLASS =
  "translate-y-full opacity-0 transition-[transform,opacity] duration-base ease-standard group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-reduce:transition-none";

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
 * priceTagPosition controls placement: in the title area (`below`), at one of
 * the floating spots (4 corners + center vertical axis), or `hidden`; the
 * spot actually used comes from resolvePriceTagPosition, which lifts a bottom
 * tag off an overlay/shadow title bar so the price and the product name can
 * never share the same corner. The chip's own appearance (font, size, fill,
 * text, border, roundness) is a set of bounded fields rendered by
 * priceTagChipStyle. A block the seller marked sold out dims its image and
 * (per theme.soldOutBadge) wears a corner badge. Accent and the sold-out badge
 * stay theme-wide by design.
 */
export function ProductTileContent({
  product,
  theme,
  overrides,
  soldOut = false,
  imagePlacement,
  imageRef,
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
}) {
  const card = resolveCardStyle(theme, overrides);

  // Overlay + shadow render the title area over the image; bar sits below it.
  const shadowArea = card.titleStyle === "shadow";
  const titleHover = card.titleDisplay === "hover";

  // "hidden" position is the single hide switch (legacy priceDisplay "never"
  // is migrated to it by the schema).
  const priceHidden = card.priceTagPosition === "hidden";

  // The two structural rules that can take a spot away: a heavy corner radius
  // clips the corners off, and an overlay/shadow title bar occupies the bottom
  // of the image — the same box a floated tag sits in, so bottom spots lift to
  // the top rather than landing on the product name.
  const tagPosition = resolvePriceTagPosition(card.priceTagPosition, {
    cornerRadius: card.cornerRadius,
    titleOverlaysImage: titleOverlaysImage(card.titleStyle),
  });

  // What the chip paints where the seller chose nothing: the fill follows the
  // placement (a backing over a photo, none in the info bar), the text the
  // accent. Both resolvers are shared with the pickers, so the panel's "Auto"
  // dot always shows what the tile is really doing. An explicit color wins
  // over either, inside priceTagChipStyle.
  const chipStyle = priceTagChipStyle(card, {
    fill: defaultPriceTagFill(card.priceTagPosition),
    text: priceTagAutoTextColor(card, theme.accent),
  });
  const chipFontClass = PRICE_TAG_FONT_CLASSES[card.priceTagFont];

  // Every pixel of the chip is inline (see priceTagChipStyle); the classes
  // carry only placement, typeface and the hover reveal.
  const floatedPrice =
    !priceHidden && tagPosition !== "below" && tagPosition !== "hidden" ? (
      <span
        className={cn(
          "absolute z-10",
          chipFontClass,
          PRICE_TAG_FLOAT_CLASSES[tagPosition as PriceTagFloatPosition],
          card.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        style={chipStyle}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Price in the title area, only when position is "below" and not hidden.
  const inlinePrice =
    !priceHidden && card.priceTagPosition === "below" ? (
      <span
        className={cn(
          "shrink-0",
          chipFontClass,
          card.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        style={chipStyle}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Title area: shown when the title is visible OR when the price sits below
  // (then it renders with just the price so the layout keeps its shape).
  const showTitleArea =
    card.showTitle || (!priceHidden && card.priceTagPosition === "below");

  const titleArea = showTitleArea ? (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 px-2 py-1.5",
        card.titleStyle === "bar" && "bg-card",
        card.titleStyle === "overlay" &&
          "absolute inset-x-0 bottom-0 bg-card/90",
        // Shadow: no bar, a bottom-up gradient over the image for legibility.
        shadowArea &&
          "absolute inset-x-0 bottom-0 items-end bg-gradient-to-t from-black/70 via-black/35 to-transparent pt-8",
        titleHover &&
          (card.titleStyle === "overlay" ? HOVER_RISE_CLASS : HOVER_REVEAL_CLASS),
      )}
    >
      {card.showTitle && (
        <span
          className={cn(
            // min-w-0 states what `truncate`'s overflow already implies: the
            // title yields to the price rather than pushing it out of the row.
            // With the price shrink-0 beside it, the two cannot overlap.
            "min-w-0 truncate text-xs font-medium",
            shadowArea ? "text-white drop-shadow-sm" : "text-foreground",
          )}
        >
          {product.title}
        </span>
      )}
      {inlinePrice}
    </div>
  ) : null;

  return (
    // Corner clipping comes from the grid cell / carousel tile (border-radius
    // + overflow-hidden per the resolved cornerRadius); the face needs no
    // clip of its own.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-muted">
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
          <span className="absolute left-2 top-2 z-10 rounded-sm bg-primary px-1.5 py-0.5 font-inter text-xs font-medium text-primary-foreground">
            Sold out
          </span>
        )}
      </div>
      {titleArea}
    </div>
  );
}
