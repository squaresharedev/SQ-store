"use client";

import { useMemo, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock } from "@/components/grid/gridConstants";
import { resolveInk } from "@/components/product-page/product-page-maps";
import { BlockFace } from "@/components/storefront/BlockFace";
import { StorefrontMasthead } from "@/components/storefront/StorefrontMasthead";
import { resolveBackgroundStyle } from "@/components/storefront/background-presets";
import {
  TILE_FACE_CLASS,
  blockTileClipStyle,
  gridGapStyle,
  scaledCornerRadius,
  tileClipStyle,
  tileFrameClass,
} from "@/components/storefront/config-maps";
import { customFontVars, fontPresentation } from "@/lib/theme/storefront-fonts";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  EMPTY_STOREFRONT_HEADER,
  blockKey,
  isFreelyArranged,
  layerOrder,
  readingOrder,
  tileCovers,
  type StorefrontBlock,
} from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";

/**
 * A SELLER'S BOARD, AS A BUYER SEES IT: the masthead and the grid of tiles,
 * with each product tile a link to its page.
 *
 * The one drawing of it, shared by the two places a buyer meets a storefront:
 * its hosted page (StorefrontPageView) and the embed frame on the seller's own
 * website (EmbedFrameView). Drawn with the designer's own pieces (the shared
 * <Grid> in static mode, the same tile faces, the same masthead, the same
 * enum-to-class maps), so what a buyer opens is what the seller saw on the
 * canvas, not a second rendering that can drift from it.
 *
 * The board reflows on a narrow screen exactly as the designer's phone preview
 * does, and for the same reason does not when blocks are tilted or stacked:
 * pulling a word off the shape it sits on is a different design, not a smaller
 * one (see DesignerCanvas).
 */

/**
 * What a tile face is handed. The faces take the seller-side Product, so the
 * fields a tile never reads are filled with values that say nothing: the
 * server sent none of them (types/storefront-page.ts), and nothing here can
 * disclose a stock count it was never given.
 */
function asFaceProduct(tile: StorefrontTileProduct): Product {
  return {
    id: tile.id,
    title: tile.title,
    description: "",
    // A face is handed the REGULAR price as the product's own and, while a
    // sale runs, the price it sets beside it (ProductTileSale).
    price: tile.regularPrice ?? tile.price,
    ...(tile.regularPrice !== undefined
      ? { sale: { price: tile.price, offerPercent: tile.offerPercent ?? null } }
      : {}),
    currency: tile.currency,
    status: "active",
    imageUrl: tile.imageUrl,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 0,
    maxPerOrder: 1,
  };
}

/**
 * The backdrop a board sits on, for whatever element wraps it: the seller's
 * background, gap and typeface, and the ink that reads on that background.
 *
 * Schema-constrained, same as the canvas: hex is re-gated by the strict regex,
 * the gap is a bounded integer feeding the --grid-gap token.
 */
export function storefrontSurface(page: StorefrontPageData): {
  ink: string;
  className: string | undefined;
  style: CSSProperties;
} {
  const { theme } = page;
  const ink = resolveInk(theme);
  const presentation = fontPresentation(theme.font);
  return {
    ink,
    className: presentation.className,
    style: {
      ...resolveBackgroundStyle(theme.background, page.backgroundImageUrl),
      ...gridGapStyle(theme.gridGap),
      ...customFontVars(theme.customFont, page.customFontUrl),
      color: ink,
      ...presentation.style,
    },
  };
}

export function StorefrontBoard({
  page,
  displayName,
  tilesOpenNewTab = false,
}: {
  page: StorefrontPageData;
  /** The shop's name as buyers know it, for the grid's label and empty line. */
  displayName: string;
  /** The embed frame: a product opens in a tab of its own, so the seller's
   *  page stays where it is behind it. */
  tilesOpenNewTab?: boolean;
}) {
  const t = useTranslations("ProductPage.storefront");
  const { theme, header } = page;

  const tiles = useMemo(
    () => new Map(page.products.map((tile) => [tile.id, { href: tile.href, product: asFaceProduct(tile) }])),
    [page.products],
  );
  const blocks = useMemo(() => readingOrder(page.blocks), [page.blocks]);

  // Depth over the blocks this page DRAWS, like the preview: a tile that was
  // dropped on the server leaves no hole in the stack.
  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(() => {
    const depths = new Map(layerOrder(blocks).map((block, index) => [blockKey(block), index]));
    return blocks.map((block) => {
      const key = blockKey(block);
      return {
        key,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        rotation: block.rotation,
        z: depths.get(key),
        data: block,
      };
    });
  }, [blocks]);
  const covers = useMemo(() => tileCovers(theme, blocks), [theme, blocks]);
  const freelyArranged = useMemo(() => isFreelyArranged(blocks), [blocks]);
  // Only the rows the board uses. The designer shows every row because empty
  // ones are room to build in; to a buyer they are a screen of nothing between
  // the last tile and the footer.
  const usedRows = useMemo(
    () => Math.min(theme.rows, Math.max(1, ...blocks.map((block) => block.y + block.h))),
    [blocks, theme.rows],
  );

  return (
    <>
      <StorefrontMasthead header={header ?? EMPTY_STOREFRONT_HEADER} theme={theme} />
      {gridBlocks.length === 0 ? (
        <p className="py-16 text-center text-sm opacity-70" data-storefront-empty="">
          {t("empty", { store: displayName })}
        </p>
      ) : (
        <Grid
          blocks={gridBlocks}
          ariaLabel={t("gridLabel", { store: displayName })}
          columns={theme.columns}
          rows={usedRows}
          responsive={!freelyArranged}
          // A block under a product on the same cells takes that card's
          // corners, exactly as it does on the canvas (blockTileClipStyle).
          cellStyle={(placement, gridBlock) =>
            gridBlock
              ? blockTileClipStyle(theme, gridBlock.data, placement, covers.get(gridBlock.key))
              : tileClipStyle(scaledCornerRadius(theme.cornerRadius, placement))
          }
          renderBlock={(gridBlock) => {
            const block = gridBlock.data;
            const tile = block.type === "product" ? tiles.get(block.productId) : undefined;
            const face = (
              <div className={TILE_FACE_CLASS}>
                <BlockFace
                  block={block}
                  product={tile?.product ?? null}
                  theme={theme}
                  imageUrl={page.imageUrls[gridBlock.key] ?? null}
                />
              </div>
            );
            // A product tile is the way to its page. Every other block is
            // part of the picture and leads nowhere.
            return tile ? (
              <a
                href={tile.href}
                // noreferrer as well as noopener: the new tab is handed
                // neither this window nor the address of the page it was on.
                {...(tilesOpenNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={cn(
                  tileFrameClass(block),
                  "block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
                data-storefront-tile={block.type === "product" ? block.productId : undefined}
              >
                {face}
              </a>
            ) : (
              <div className={tileFrameClass(block)}>{face}</div>
            );
          }}
        />
      )}
    </>
  );
}
