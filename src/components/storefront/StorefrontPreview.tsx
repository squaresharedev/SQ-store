"use client";

import { useMemo } from "react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_HEADER,
  blockKey,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock } from "@/components/grid/gridConstants";
import { BlockTile } from "./BlockTile";
import { CarouselStrip } from "./CarouselStrip";
import { StorefrontMasthead } from "./StorefrontMasthead";
import { resolveBackgroundStyle } from "./background-presets";
import { DENSITY_CLASSES, FONT_CLASSES, RADIUS_CLASSES } from "./config-maps";

/** Enough blocks to fill any clipped preview box; keeps 60-block grids from
 *  rendering DOM the card never shows. */
const PREVIEW_MAX_BLOCKS = 18;

/**
 * Read-only miniature of a storefront (list cards, and later anywhere a
 * storefront needs to be shown without the editor). Renders through the SAME
 * pieces as the designer canvas — shared <Grid> in static mode, BlockTile,
 * the masthead, and the enum→class maps — so the preview can never drift from
 * what the editor shows. The parent decides the box (aspect ratio + clip).
 */
export function StorefrontPreview({
  config,
  productsById,
  className,
}: {
  config: StorefrontConfig;
  productsById: ReadonlyMap<string, Product>;
  className?: string;
}) {
  const { theme, blocks, header } = config;

  const visibleBlocks = useMemo<StorefrontBlock[]>(
    () =>
      [...blocks]
        // Buyer-facing view: hideSoldOut drops marked blocks entirely (the
        // designer canvas keeps showing them dimmed so the seller can manage).
        .filter(
          (block) =>
            !(theme.hideSoldOut && block.type === "product" && block.soldOut),
        )
        .sort((a, b) => a.order - b.order)
        .slice(0, PREVIEW_MAX_BLOCKS),
    [blocks, theme.hideSoldOut],
  );

  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(
    () =>
      visibleBlocks.map((block, index) => ({
        key: blockKey(block),
        size: block.size,
        order: index,
        data: block,
      })),
    [visibleBlocks],
  );

  const getProduct = (block: StorefrontBlock): Product | null =>
    block.type === "product"
      ? (productsById.get(block.productId) ?? null)
      : null;

  return (
    <div
      className={cn(
        "size-full p-2",
        FONT_CLASSES[theme.font],
        DENSITY_CLASSES[theme.density],
        className,
      )}
      // Schema-constrained, same as the canvas: preset keys resolve through
      // the fixed allowlist map, hex is re-gated by the strict regex.
      style={resolveBackgroundStyle(theme.background)}
    >
      <StorefrontMasthead
        header={header ?? DEFAULT_STOREFRONT_HEADER}
        theme={theme}
        compact
      />
      {visibleBlocks.length > 0 &&
        (theme.displayMode === "carousel" ? (
          <CarouselStrip
            blocks={visibleBlocks}
            getProduct={getProduct}
            theme={theme}
            compact
          />
        ) : (
          <Grid
            blocks={gridBlocks}
            ariaLabel="Storefront preview"
            columns={6}
            mobileColumns={3}
            cellClassName={RADIUS_CLASSES[theme.radius]}
            renderBlock={(gridBlock) => (
              <BlockTile
                block={gridBlock.data}
                product={getProduct(gridBlock.data)}
                theme={theme}
                editable={false}
              />
            )}
          />
        ))}
    </div>
  );
}
