"use client";

import { AlertCircle } from "lucide-react";
import { infoTextClass } from "@/components/ui/control-styles";
import type { Product } from "@/types/product";
import type { StorefrontBlock, StorefrontTheme } from "@/types/storefront";
import { ProductTileContent } from "./ProductTileContent";
import { ShapeTileContent } from "./ShapeTileContent";
import { TextTileContent } from "./TextTileContent";

/**
 * The visual face of one grid block, independent of tile chrome: dispatches to
 * the text, shape, or product content, or the flagged "product removed" state
 * when a referenced product no longer exists (never a crash). Used by the
 * in-place tile AND the drag overlay, so the floating copy always matches.
 * View-only — text/shape editing happens in the side panel.
 *
 * Block kinds: "text" → TextTileContent, "shape" → ShapeTileContent,
 * "product" → ProductTileContent (or the removed-product fallback).
 */
export function BlockFace({
  block,
  product,
  theme,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
}) {
  if (block.type === "text") {
    return <TextTileContent block={block} theme={theme} />;
  }
  if (block.type === "shape") {
    return <ShapeTileContent block={block} />;
  }
  if (product) {
    return (
      <ProductTileContent
        product={product}
        theme={theme}
        overrides={block.style}
        soldOut={block.soldOut === true}
      />
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center">
      <AlertCircle
        className="size-5 text-destructive"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className={infoTextClass}>
        Product removed. Delete this block.
      </span>
    </div>
  );
}
