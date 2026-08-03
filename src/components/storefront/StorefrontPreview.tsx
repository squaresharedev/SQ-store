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
import { useFitToBox } from "./useFitToBox";
import {
  FONT_CLASSES,
  gridGapStyle,
  scaledCornerRadius,
} from "./config-maps";

/**
 * Read-only miniature of a storefront (list cards, and later anywhere a
 * storefront needs to be shown without the editor). Renders through the SAME
 * pieces as the designer canvas — shared <Grid> in static mode, BlockTile,
 * the masthead, and the enum→class maps — so the preview can never drift from
 * what the editor shows.
 *
 * FITS, rather than crops. The board is laid out at the box's full width and
 * then scaled down by however much it takes to bring the WHOLE thing inside
 * (see useFitToBox). Previously the box simply clipped, so a tall storefront
 * showed only its top few rows and every card looked like it started the same
 * way — the one thing a preview exists to disprove.
 *
 * Every block is rendered, not a slice of them: a preview that silently drops
 * blocks is not a preview of that storefront. The schema's MAX_BLOCKS (120) is
 * the real bound on how much DOM this can produce.
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
  const { boxRef, contentRef, scale } = useFitToBox();

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
      ),
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
      ref={boxRef}
      className={cn(
        // The box. Centres the scaled board on both axes, so a board that
        // shrinks to fit its height sits in the middle rather than hugging a
        // corner. overflow-hidden is a backstop only — nothing should exceed
        // this box once scaled.
        "flex size-full items-center justify-center overflow-hidden",
        FONT_CLASSES[theme.font],
        className,
      )}
      // Schema-constrained, same as the canvas: hex is re-gated by the strict
      // regex, the gap is a bounded integer feeding the --grid-gap token.
      // The background lives on the BOX, not the scaled board, so it fills the
      // whole card even when the board is scaled down and leaves gutters.
      style={{
        ...resolveBackgroundStyle(theme.background, backgroundImageUrl),
        ...gridGapStyle(theme.gridGap),
      }}
    >
      <div
        ref={contentRef}
        // Laid out at the box's full width, then scaled. `w-full` keeps the
        // grid's container query resolving against the real card width, so
        // cell size is the same proportion it would be at full size.
        className="w-full shrink-0 p-2"
        style={{ transform: `scale(${scale})` }}
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
              // Never reflow: the preview is scaled down as a whole, so the
              // board keeps the exact column count and coordinates the seller
              // designed. Reflowing would show a layout the storefront doesn't
              // have — the one thing a preview must not do.
              responsive={false}
              cellStyle={(placement) => ({
                borderRadius: scaledCornerRadius(theme.cornerRadius, placement),
              })}
              renderBlock={(gridBlock) => (
                <BlockTile
                  blockKey={gridBlock.key}
                  block={gridBlock.data}
                  product={getProduct(gridBlock.data)}
                  theme={theme}
                  editable={false}
                />
              )}
            />
          ))}
      </div>
    </div>
  );
}
