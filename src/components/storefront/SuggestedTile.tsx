"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { addIconButtonClass, iconPopClass } from "@/components/ui/control-styles";
import { suggestedTileButtonClass, suggestedTileFaceClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { StorefrontTheme } from "@/types/storefront";
import { TILE_FACE_CLASS } from "./config-maps";
import { ProductTileContent } from "./ProductTileContent";

/**
 * The product an empty board suggests: the real tile, greyed out, with a "+"
 * that places it. It is never a block, so it cannot be saved, moved or selected;
 * the first thing placed on the board takes its place.
 */
export function SuggestedTile({
  product,
  theme,
  onAccept,
}: {
  product: Product;
  theme: StorefrontTheme;
  onAccept: (productId: string) => void;
}) {
  const t = useTranslations("Storefront.canvas");
  return (
    <div className="relative size-full rounded-[inherit]" data-suggested-tile={product.id}>
      <div aria-hidden="true" inert className={cn(TILE_FACE_CLASS, suggestedTileFaceClass)}>
        <ProductTileContent product={product} theme={theme} />
      </div>
      <button
        type="button"
        onClick={() => onAccept(product.id)}
        aria-label={t("addSuggested", { title: product.title })}
        className={suggestedTileButtonClass}
      >
        <span className={addIconButtonClass}>
          <Plus className={cn("size-4", iconPopClass)} strokeWidth={2} aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
