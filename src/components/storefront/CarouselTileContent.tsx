"use client";

import type { CarouselBlock, StorefrontTheme } from "@/types/storefront";

/**
 * The face of a product carousel.
 *
 * CONTRACT STUB (editor upgrade, motion and finish): the block kind exists in
 * the schema and every renderer already dispatches here, so this file is the
 * one place its face is drawn. Until it is built it shows how many products
 * it holds.
 */
export function CarouselTileContent({
  block,
}: {
  block: CarouselBlock;
  theme: StorefrontTheme;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 text-center text-sm">
      {block.productIds.length}
    </div>
  );
}
