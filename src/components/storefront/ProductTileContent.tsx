"use client";

import { Image as ImageIcon } from "lucide-react";
import type { Product } from "@/types/product";
import {
  coercePriceTagPosition,
  type PriceTagFloatPosition,
  type StorefrontTheme,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PRICE_TAG_FLOAT_CLASSES } from "./config-maps";

// Reveal-on-hover also reveals on keyboard focus within the tile; with
// reduced motion the change is instant instead of faded.
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-180 ease-in-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none";

// Slide-up reveal for the overlay title bar: it rises from the tile's bottom
// edge on hover/focus (the grid cell clips the off-canvas start position).
const HOVER_RISE_CLASS =
  "translate-y-full opacity-0 transition-[transform,opacity] duration-180 ease-in-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 motion-reduce:transition-none";

/**
 * The product face of a grid tile. The title area renders per the theme's
 * titleStyle: `bar` = solid bar under the image, `overlay` = translucent bar
 * over the image bottom, `shadow` = text over a bottom gradient shadow on the
 * image. titleDisplay shows the area always or only on hover/focus; on reveal
 * the overlay bar slides up from the bottom edge, the others fade. The
 * theme's priceDisplay independently shows the price always or only on
 * hover/focus. priceTagPosition controls placement: in the title area
 * (`below`), at one of the floating spots (4 corners + center vertical axis),
 * or `hidden`. priceTagStyle controls chip appearance (plain / pill). A block
 * the seller marked sold out dims its image and (per theme.soldOutBadge)
 * wears a corner badge.
 */
export function ProductTileContent({
  product,
  theme,
  soldOut = false,
}: {
  product: Product;
  theme: StorefrontTheme;
  soldOut?: boolean;
}) {
  // Overlay + shadow render the title area over the image; bar sits below it.
  const shadowArea = theme.titleStyle === "shadow";
  const titleHover = theme.titleDisplay === "hover";

  // "hidden" position is the single hide switch (legacy priceDisplay "never"
  // is migrated to it by the schema).
  const priceHidden = theme.priceTagPosition === "hidden";

  // Accent color re-gated before any style attribute.
  const accentStyle =
    isStrictHexColor(theme.accent) ? { color: theme.accent } : undefined;

  // Heavily rounded tiles clip their corners away, so corner spots are coerced
  // onto the same row's center spot (storage keeps the seller's corner choice).
  const tagPosition = coercePriceTagPosition(
    theme.priceTagPosition,
    theme.cornerRadius,
  );

  // Price floated on the image gets a translucent backing for legibility.
  const floatedPrice =
    !priceHidden && tagPosition !== "below" && tagPosition !== "hidden" ? (
      <span
        className={cn(
          "absolute z-10 font-inter text-xs",
          PRICE_TAG_FLOAT_CLASSES[tagPosition as PriceTagFloatPosition],
          // Style chip
          theme.priceTagStyle === "pill"
            ? "rounded-full border border-border bg-card/90 px-2 py-0.5"
            : "rounded-sm bg-card/90 px-1.5 py-0.5",
          theme.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        style={accentStyle}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Price in the title area, only when position is "below" and not hidden.
  // On the shadow gradient a plain price drops the accent for white so it
  // stays readable; the pill chip carries its own backing anywhere.
  const inlinePrice =
    !priceHidden && theme.priceTagPosition === "below" ? (
      <span
        className={cn(
          "shrink-0 font-inter text-xs",
          theme.priceTagStyle === "pill"
            ? "rounded-full border border-border bg-card/90 px-2 py-0.5"
            : shadowArea && "text-white",
          theme.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        style={shadowArea && theme.priceTagStyle !== "pill" ? undefined : accentStyle}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Title area: shown when the title is visible OR when the price sits below
  // (then it renders with just the price so the layout keeps its shape).
  const showTitleArea =
    theme.showTitle || (!priceHidden && theme.priceTagPosition === "below");

  const titleArea = showTitleArea ? (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 px-2 py-1.5",
        theme.titleStyle === "bar" && "bg-card",
        theme.titleStyle === "overlay" &&
          "absolute inset-x-0 bottom-0 bg-card/90",
        // Shadow: no bar, a bottom-up gradient over the image for legibility.
        shadowArea &&
          "absolute inset-x-0 bottom-0 items-end bg-gradient-to-t from-black/70 via-black/35 to-transparent pt-8",
        titleHover &&
          (theme.titleStyle === "overlay" ? HOVER_RISE_CLASS : HOVER_REVEAL_CLASS),
      )}
    >
      {theme.showTitle && (
        <span
          className={cn(
            "truncate text-xs font-medium",
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
    // + overflow-hidden per theme.cornerRadius); the face needs no clip of
    // its own.
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 bg-muted">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img
            src={product.imageUrl}
            alt=""
            // Images are natively draggable, which hijacks a tile drag on the
            // canvas and shows a not-allowed cursor.
            draggable={false}
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
