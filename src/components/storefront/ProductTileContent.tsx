"use client";

import { Image as ImageIcon } from "lucide-react";
import type { Product } from "@/types/product";
import { resolvePriceTagCorner, type StorefrontTheme } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CARD_SHAPE_CLASSES,
  PRICE_TAG_CORNER_CLASSES,
  PRICE_TAG_SIZE_CLASSES,
} from "./config-maps";

// Reveal-on-hover also reveals on keyboard focus within the tile; with
// reduced motion the change is instant instead of faded.
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-180 ease-in-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none";

/**
 * The product face of a grid tile, rendered per the theme's card style:
 * `standard` = info bar under the image, `overlay` = info bar over the image
 * bottom, `minimal` = image only with info revealed on hover/focus. The
 * theme's priceDisplay independently shows the price always / on hover /
 * never. priceTagPosition controls placement (below / onImage / corner /
 * hidden); priceTagStyle controls chip appearance (plain / pill). A block the
 * seller marked sold out dims its image and (per theme.soldOutBadge) wears a
 * corner badge.
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
  const overlaid = theme.cardStyle !== "standard";

  // Price is hidden when priceDisplay === "never" OR priceTagPosition === "hidden".
  const priceHidden =
    theme.priceDisplay === "never" || theme.priceTagPosition === "hidden";

  // Accent color re-gated before any style attribute.
  const accentStyle =
    isStrictHexColor(theme.accent) ? { color: theme.accent } : undefined;

  // Tag sizing (text + padding) is one axis, chip style (plain/pill) another —
  // both resolve through fixed maps. Legacy "corner" configs float top-right
  // via resolvePriceTagCorner; new configs carry an explicit corner.
  const tagSizeClass = PRICE_TAG_SIZE_CLASSES[theme.priceTagSize ?? "md"];

  // Price floated on the image gets a translucent backing for legibility.
  const floatedPrice =
    !priceHidden && theme.priceTagPosition !== "below" ? (
      <span
        className={cn(
          "absolute z-10 font-inter",
          PRICE_TAG_CORNER_CLASSES[resolvePriceTagCorner(theme)],
          tagSizeClass,
          theme.priceTagStyle === "pill"
            ? "rounded-full border border-border bg-card/90"
            : "rounded-sm bg-card/90",
          theme.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        style={accentStyle}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Price in the info bar — only when position is "below" and not hidden.
  const inlinePrice =
    !priceHidden && theme.priceTagPosition === "below" ? (
      <span
        className={cn(
          "shrink-0 font-inter",
          // In the bar, size means text size; padding only once it's a chip.
          tagSizeClass,
          theme.priceTagStyle !== "pill" && "p-0",
          theme.priceTagStyle === "pill" &&
            "rounded-full border border-border bg-card/90",
          theme.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        style={accentStyle}
      >
        {formatPrice(product.price, product.currency)}
      </span>
    ) : null;

  // Info bar: shown when title is visible OR when price sits below (show bar
  // with just the price so it keeps its natural position in the layout).
  const showInfoBar =
    theme.showTitle || (!priceHidden && theme.priceTagPosition === "below");

  const infoBar = showInfoBar ? (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 bg-card px-2 py-1.5",
        overlaid && "absolute inset-x-0 bottom-0 bg-card/90",
        theme.cardStyle === "minimal" && HOVER_REVEAL_CLASS,
      )}
    >
      {theme.showTitle && (
        <span className="truncate text-xs font-medium text-foreground">
          {product.title}
        </span>
      )}
      {inlinePrice}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col",
        // Product-tile clip: square / rounded (inherit) / circle.
        CARD_SHAPE_CLASSES[theme.cardShape],
      )}
    >
      <div className="relative min-h-0 flex-1 bg-muted">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img
            src={product.imageUrl}
            alt=""
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
        {/* Floated price (onImage / corner) — positioned over the image area. */}
        {floatedPrice}
        {soldOut && theme.soldOutBadge && (
          <span className="absolute left-2 top-2 z-10 rounded-sm bg-primary px-1.5 py-0.5 font-inter text-xs font-medium text-primary-foreground">
            Sold out
          </span>
        )}
      </div>
      {infoBar}
    </div>
  );
}
