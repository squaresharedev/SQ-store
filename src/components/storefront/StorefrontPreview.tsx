"use client";

import { useMemo } from "react";
import type { Product } from "@/types/product";
import {
  EMPTY_STOREFRONT_HEADER,
  blockCornerRadius,
  blockKey,
  buyerVisibleBlocks,
  layerOrder,
  readingOrder,
  type CardStyleOverrides,
  type ProductBlock,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  customFontVars,
  fontPresentation,
} from "@/lib/theme/storefront-fonts";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock } from "@/components/grid/gridConstants";
import { BlockTile } from "./BlockTile";
import { CarouselStrip } from "./CarouselStrip";
import { CustomFontFace } from "./CustomFontFace";
import { StorefrontMasthead } from "./StorefrontMasthead";
import { resolveBackgroundStyle } from "./background-presets";
import { useFitToBox } from "./useFitToBox";
import { gridGapStyle, scaledCornerRadius, tileClipStyle } from "./config-maps";

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
 *
 * `textless` is the one exception, and it is a deliberate one: it renders the
 * storefront with none of its words at all (see textlessBlocks). The list card
 * asks for it only for a storefront with no products to show, where the
 * alternative is a card whose whole picture is a paragraph shrunk past
 * reading — see drawsProducts and the card itself.
 */
/**
 * What a `textless` preview draws: the faces that are picture or shape alone.
 *
 * Dropping a face is the only honest way to take its words off it. A text
 * block emptied of its text draws "Empty text block" in their place, and the
 * two notices — a product the seller deleted, an element whose artwork this
 * preview cannot resolve — exist to BE read. Image blocks go for that second
 * reason and not because they are pictures: the preview is handed no signed
 * URL for them, so every one of them renders as the notice.
 *
 * Nothing shifts when a block goes. Blocks carry their own coordinates, so the
 * ones that remain stay exactly where the seller put them and the dropped
 * block leaves the same empty square the board already has elsewhere.
 *
 * Product tiles stay, minus the card settings that print words on them: a
 * per-tile override that switched its own title or price tag back on would
 * make that one tile the exception on an otherwise silent card. The rest of a
 * tile's overrides (roundness, tag style) never draw text and are left alone.
 *
 * Exported because the card asks the same question to decide whether it is
 * looking at an empty storefront — emptiness has to mean "nothing will be
 * drawn", not "no blocks exist".
 */
export function textlessBlocks(
  config: StorefrontConfig,
  productsById: ReadonlyMap<string, Product>,
): StorefrontBlock[] {
  return buyerVisibleBlocks(config)
    .filter((block) =>
      block.type === "product"
        ? productsById.has(block.productId)
        : block.type === "shape",
    )
    .map((block) =>
      block.type === "product" ? silenceProductBlock(block) : block,
    );
}

/**
 * Whether this preview will draw a single product tile.
 *
 * The question a caller asks to decide whether the storefront is worth showing
 * in its own words. A board with products is a shop, and its text is part of
 * the picture; a board with none is a design, and at card size its words are
 * the only thing legible enough to dominate — which is how a card ends up
 * being a paragraph of type where a storefront should be.
 *
 * "Will draw", not "declares": a sold-out block hidden from buyers, and one
 * whose product the seller has since deleted, both count for nothing here.
 */
export function drawsProducts(
  config: StorefrontConfig,
  productsById: ReadonlyMap<string, Product>,
): boolean {
  return buyerVisibleBlocks(config).some(
    (block) => block.type === "product" && productsById.has(block.productId),
  );
}

function silenceProductBlock(block: ProductBlock): ProductBlock {
  const style = silenceCardStyle(block.style);
  return style === block.style ? block : { ...block, style };
}

/** A block's overrides with the two that can print words removed. Returns the
 *  original object when there was nothing to remove, so an untouched tile
 *  keeps its identity (and the memoised BlockTile its props). */
function silenceCardStyle(
  style: CardStyleOverrides | undefined,
): CardStyleOverrides | undefined {
  if (!style) return style;
  if (style.showTitle === undefined && style.priceTagPosition === undefined) {
    return style;
  }
  const rest: CardStyleOverrides = { ...style };
  delete rest.showTitle;
  delete rest.priceTagPosition;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** The theme's own half of the same silencing: title, price tag and sold-out
 *  badge are all card settings, so turning them off here takes the words off
 *  every product tile without the tile code knowing this mode exists. */
function silenceTheme(theme: StorefrontTheme): StorefrontTheme {
  return {
    ...theme,
    showTitle: false,
    priceTagPosition: "hidden",
    soldOutBadge: false,
  };
}

export function StorefrontPreview({
  config,
  productsById,
  className,
  backgroundImageUrl = null,
  customFontUrl = null,
  textless = false,
}: {
  config: StorefrontConfig;
  productsById: ReadonlyMap<string, Product>;
  className?: string;
  /** Display URL for an image background; without one the preview shows the
   *  neutral base color instead. */
  backgroundImageUrl?: string | null;
  /** Display URL for an uploaded theme font; without one the preview renders
   *  in the inherited face, exactly as it does without a background URL. */
  customFontUrl?: string | null;
  /** Draw the storefront with none of its WORDS: no masthead, no text blocks,
   *  no titles or price tags on product tiles. What is left is the layout, the
   *  colours and the pictures — a thumbnail rather than a small read (see
   *  textlessBlocks). */
  textless?: boolean;
}) {
  const { theme, header } = config;
  const { boxRef, contentRef, scale } = useFitToBox();
  const canvasFont = fontPresentation(theme.font);

  // Buyer-facing view: hideSoldOut drops marked blocks entirely (the designer
  // canvas keeps showing them dimmed so the seller can manage them). Shared
  // with whatever else needs to know whether this renders as empty.
  const visibleBlocks = useMemo<StorefrontBlock[]>(
    () =>
      readingOrder(
        textless
          ? textlessBlocks(config, productsById)
          : buyerVisibleBlocks(config),
      ),
    [config, productsById, textless],
  );

  // Every tile renders against this, so the words a product tile draws are
  // switched off at the source rather than hidden after the fact.
  const tileTheme = useMemo<StorefrontTheme>(
    () => (textless ? silenceTheme(theme) : theme),
    [textless, theme],
  );

  // Resolved once for the whole board, not per cell: layerOrder sorts every
  // block, and a preview page renders many of these side by side.
  //
  // Depth is taken over the blocks this preview actually DRAWS, so a hidden
  // sold-out tile leaves no hole in the stack. The order between the blocks
  // that remain is what the seller arranged, which is all a paint order has to
  // preserve.
  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(() => {
    const depths = new Map(
      layerOrder(visibleBlocks).map((block, index) => [blockKey(block), index]),
    );
    return visibleBlocks.map((block) => {
      const key = blockKey(block);
      return {
        key,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        // The miniature is tilted and stacked exactly as the board is. A
        // preview that straightened or re-stacked everything would be a
        // preview of a different design.
        rotation: block.rotation,
        z: depths.get(key),
        data: block,
      };
    });
  }, [visibleBlocks]);

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
        canvasFont.className,
        className,
      )}
      // Schema-constrained, same as the canvas: hex is re-gated by the strict
      // regex, the gap is a bounded integer feeding the --grid-gap token.
      // The background lives on the BOX, not the scaled board, so it fills the
      // whole card even when the board is scaled down and leaves gutters.
      style={{
        ...resolveBackgroundStyle(theme.background, backgroundImageUrl),
        ...gridGapStyle(theme.gridGap),
        ...customFontVars(theme.customFont, customFontUrl),
        ...canvasFont.style,
      }}
    >
      <CustomFontFace customFont={theme.customFont} url={customFontUrl} />
      <div
        ref={contentRef}
        // Laid out at the box's full width, then scaled. `w-full` keeps the
        // grid's container query resolving against the real card width, so
        // cell size is the same proportion it would be at full size.
        className="w-full shrink-0 p-2"
        style={{ transform: `scale(${scale})` }}
      >
        {!textless && (
          <StorefrontMasthead
            header={header ?? EMPTY_STOREFRONT_HEADER}
            theme={theme}
            compact
          />
        )}
        {visibleBlocks.length > 0 &&
          (theme.displayMode === "carousel" ? (
            <CarouselStrip
              blocks={visibleBlocks}
              getProduct={getProduct}
              theme={tileTheme}
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
              cellStyle={(placement, gridBlock) =>
                tileClipStyle(
                  scaledCornerRadius(
                    gridBlock
                      ? blockCornerRadius(tileTheme, gridBlock.data)
                      : tileTheme.cornerRadius,
                    placement,
                  ),
                )
              }
              renderBlock={(gridBlock) => (
                <BlockTile
                  blockKey={gridBlock.key}
                  block={gridBlock.data}
                  product={getProduct(gridBlock.data)}
                  theme={tileTheme}
                  editable={false}
                />
              )}
            />
          ))}
      </div>
    </div>
  );
}
