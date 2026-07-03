"use client";

import { Image as ImageIcon } from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontTheme } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

// Reveal-on-hover also reveals on keyboard focus within the tile; with
// reduced motion the change is instant instead of faded.
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity duration-180 ease-in-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none";

/**
 * The product face of a grid tile, rendered per the theme's card style:
 * `standard` = info bar under the image, `overlay` = info bar over the image
 * bottom, `minimal` = image only with info revealed on hover/focus. The
 * theme's priceDisplay independently shows the price always / on hover /
 * never.
 */
export function ProductTileContent({
  product,
  theme,
}: {
  product: Product;
  theme: StorefrontTheme;
}) {
  const overlaid = theme.cardStyle !== "standard";

  const price =
    theme.priceDisplay === "never" ? null : (
      <span
        className={cn(
          "shrink-0 font-inter text-xs",
          theme.priceDisplay === "hover" && HOVER_REVEAL_CLASS,
        )}
        // Accent is schema-constrained hex; re-gate anyway before styling.
        style={
          isStrictHexColor(theme.accent) ? { color: theme.accent } : undefined
        }
      >
        {formatPrice(product.price, product.currency)}
      </span>
    );

  const infoBar = (
    <div
      className={cn(
        "flex items-baseline justify-between gap-2 bg-card px-2 py-1.5",
        overlaid && "absolute inset-x-0 bottom-0 bg-card/90",
        theme.cardStyle === "minimal" && HOVER_REVEAL_CLASS,
      )}
    >
      <span className="truncate text-xs font-medium text-foreground">
        {product.title}
      </span>
      {price}
    </div>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 bg-muted">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
          <img src={product.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <ImageIcon
              className="size-6 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </div>
        )}
      </div>
      {infoBar}
    </div>
  );
}
