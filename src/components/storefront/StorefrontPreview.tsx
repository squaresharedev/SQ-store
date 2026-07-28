"use client";

import { useMemo } from "react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_HEADER,
  blockKey,
  readingOrder,
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
import {
  FONT_CLASSES,
  gridGapStyle,
  scaledCornerRadius,
} from "./config-maps";

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
  backgroundImageUrl = null,
}: {
  config: StorefrontConfig;
  productsById: ReadonlyMap<string, Product>;
  className?: string;
  /** Display URL for an image background; without one the preview shows the
   *  neutral base color instead. */
  backgroundImageUrl?: string | null;
}) {
  const { theme, blocks, header } = config;

  const visibleBlocks = useMemo<StorefrontBlock[]>(
    () =>
      readingOrder(
        blocks.filter(
          // Buyer-facing view: hideSoldOut drops marked blocks entirely (the
          // designer canvas keeps showing them dimmed so the seller can
          // manage them).
          (block) =>
            !(theme.hideSoldOut && block.type === "product" && block.soldOut),
        ),
      ).slice(0, PREVIEW_MAX_BLOCKS),
    [blocks, theme.hideSoldOut],
  );

  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(
    () =>
      visibleBlocks.map((block) => ({
        key: blockKey(block),
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
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
      className={cn("size-full p-2", FONT_CLASSES[theme.font], className)}
      // Schema-constrained, same as the canvas: hex is re-gated by the strict
      // regex, the gap is a bounded integer feeding the --grid-gap token.
      style={{
        ...resolveBackgroundStyle(theme.background, backgroundImageUrl),
        ...gridGapStyle(theme.gridGap),
      }}
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
            columns={theme.columns}
            rows={theme.rows}
            cellStyle={(placement) => ({
              borderRadius: scaledCornerRadius(theme.cornerRadius, placement),
            })}
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
