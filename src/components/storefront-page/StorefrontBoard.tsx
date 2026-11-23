"use client";

import { useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock } from "@/components/grid/gridConstants";
import { resolveInk } from "@/components/product-page/product-page-maps";
import { BlockFace } from "@/components/storefront/BlockFace";
import { CarouselCardAnchor, type CarouselCards } from "@/components/storefront/CarouselTileContent";
import { keepsRowsWhenNarrow } from "@/lib/storefront/carousel";
import { BlockBlurCopies } from "@/components/storefront/BlockBlurCopies";
import { phoneGridLayout } from "@/components/storefront/phone-grid";
import { StorefrontMasthead } from "@/components/storefront/StorefrontMasthead";
import { boardBackgroundStyle } from "@/components/storefront/background-presets";
import {
  cardHoverFrameClass,
  TILE_FACE_CLASS,
  blockBlurStyle,
  blockTileClipStyle,
  gridGapStyle,
  scaledCornerRadius,
  tileClipStyle,
  tileFrameClass,
} from "@/components/storefront/config-maps";
import { customFontVars, fontPresentation } from "@/lib/theme/storefront-fonts";
import { pairingFontPresentation } from "@/lib/theme/font-pairing-presentation";
import { paletteInk } from "@/lib/storefront/palette";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import {
  EMPTY_STOREFRONT_HEADER,
  blockFine,
  blockKey,
  layerOrder,
  readingOrder,
  resolveCardStyle,
  tileCovers,
  type CardBuyButton,
  type StorefrontBlock,
} from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";
import type { TileQuickAddAction } from "@/components/storefront/ProductTileContent";
import { useCart } from "@/components/cart/CartContext";
import { bandUnderlays } from "@/components/storefront/band-underlays";
import { bandsBottom, blockBackdrop } from "@/lib/storefront/bands";
import { buttonLinkKey, headerLinkKey, linkAnchorProps } from "@/lib/storefront/links";
import { isFreelyArrangedAsDrawn } from "@/lib/storefront/layout-blocks";
import { QuickAddTile } from "./QuickAddTile";
import { BoardMotion } from "@/components/storefront/BoardMotion";

/** A link on a buyer's board takes focus in the board's own ink (see the
 *  product tile's link below for why not the dashboard's grey). */
const BOARD_LINK_FOCUS_CLASS =
  "block outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current";

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
    // The card extras, exactly as sent: a photo, two numbers about reviews,
    // and a stock STATE (never a count, see StorefrontTileProduct).
    ...(tile.hoverImageUrl ? { hoverImageUrl: tile.hoverImageUrl } : {}),
    ...(tile.rating ? { rating: tile.rating } : {}),
    ...(tile.stockState ? { stockState: tile.stockState } : {}),
    ...(tile.quickAdd ? { quickAdd: tile.quickAdd } : {}),
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
  // Type and colour (editor upgrade): a stored palette's Text colour when it
  // reads on the background, and a font pairing's two faces when there is one.
  const ink = paletteInk(theme) ?? resolveInk(theme);
  const presentation = pairingFontPresentation(theme) ?? fontPresentation(theme.font);
  return {
    ink,
    // `wrap-anywhere`, inherited by every word on the page (a shop name, a
    // business name, a link pasted into a text block): one unbroken word wider
    // than a phone otherwise pushes the page sideways, and in the embed frame,
    // which clips, it is cut off. The product page does the same (PageShell).
    className: cn("wrap-anywhere", presentation.className),
    style: {
      ...boardBackgroundStyle(theme, page.backgroundImageUrl),
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
  assumedWidth,
  headerCart,
}: {
  /** The page's cart button, when it joins the header's menu (headerHasMenu). */
  headerCart?: ReactNode;
  page: StorefrontPageData;
  /** The shop's name as buyers know it, for the grid's label and empty line. */
  displayName: string;
  /** The embed frame: a product opens in a tab of its own, so the seller's
   *  page stays where it is behind it. */
  tilesOpenNewTab?: boolean;
  /** A board width to render for before the page has measured one (a phone's,
   *  for a preview drawn without JavaScript). */
  assumedWidth?: number;
}) {
  const t = useTranslations("ProductPage.storefront");
  const tLayout = useTranslations("EditorLayout.board");
  const { theme, header } = page;
  // The header's menu, its links resolved on the server (page.links); an
  // entry that led nowhere was dropped there.
  const menu = useMemo(
    () =>
      (header?.links ?? []).flatMap((entry, index) => {
        const link = page.links?.[headerLinkKey(index)];
        return link ? [{ label: entry.label, anchor: linkAnchorProps(link, { newTab: tilesOpenNewTab, pageUrl: page.url }) }] : [];
      }),
    [header, page.links, page.url, tilesOpenNewTab],
  );
  // Cards add to the cart only inside a page that has one.
  const cart = useCart();

  const tiles = useMemo(
    () => new Map(page.products.map((tile) => [tile.id, { href: tile.href, product: asFaceProduct(tile) }])),
    [page.products],
  );
  const blocks = useMemo(() => readingOrder(page.blocks), [page.blocks]);
  const { bands } = page;

  /** Whether a card of this product, wearing this buy button, puts its
   *  product straight in the cart: the cart is here, the seller's cards add
   *  to it, the product allows it, and the card shows a buy button. The same
   *  question for a product block and a carousel's card. */
  const addsToCart = useCallback(
    (tile: { product: Product } | undefined, buyButton: CardBuyButton | undefined) =>
      Boolean(tile?.product.quickAdd && cart && page.tileLook.quickAdd && buyButton !== "none"),
    [cart, page.tileLook.quickAdd],
  );

  // A carousel's cards: only the products this payload carries (the server
  // has already left out every one a buyer may not see), each opening its
  // page exactly as a product block's card does: the link, or the card whose
  // button adds to the cart.
  const carouselCards = useMemo<CarouselCards>(() => {
    const buyButton = resolveCardStyle(theme, undefined).buyButton;
    return {
      product: (productId) => tiles.get(productId)?.product ?? null,
      link: (productId, frameClassName, renderFace) => {
        const tile = tiles.get(productId);
        if (!tile) return null;
        if (tile.product.quickAdd && addsToCart(tile, buyButton)) {
          return (
            <QuickAddTile
              href={tile.href}
              newTab={tilesOpenNewTab}
              frameClassName={frameClassName}
              productId={productId}
              optionIds={tile.product.quickAdd.optionIds}
              title={tile.product.title}
              renderFace={renderFace}
            />
          );
        }
        return (
          <CarouselCardAnchor href={tile.href} newTab={tilesOpenNewTab} productId={productId} frameClassName={frameClassName}>
            {renderFace()}
          </CarouselCardAnchor>
        );
      },
    };
  }, [tiles, theme, addsToCart, tilesOpenNewTab]);

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
        // Half-cell insets, drawn by the grid (absent on every other block).
        ...(blockFine(block) ? { inset: blockFine(block) } : {}),
        // A carousel keeps its height on a phone (keepsRowsWhenNarrow).
        ...(keepsRowsWhenNarrow(block) ? { keepRows: true } : {}),
        data: block,
      };
    });
  }, [blocks]);
  // The full-width bands behind the rows, following their blocks on a phone.
  const underlays = useMemo(
    () => bandUnderlays(bands, blocks, { imageUrl: (band) => page.bandImageUrls?.[band.id], anchor: true }),
    [bands, blocks, page.bandImageUrls],
  );
  const covers = useMemo(() => tileCovers(theme, blocks), [theme, blocks]);
  const freelyArranged = useMemo(() => isFreelyArrangedAsDrawn(blocks), [blocks]);
  // The seller's own phone layout, when the board has one (types/storefront,
  // PHONE LAYOUT): drawn instead of the automatic reflow on a phone.
  const phone = useMemo(() => phoneGridLayout(theme, blocks), [theme, blocks]);
  // Only the rows the board uses. The designer shows every row because empty
  // ones are room to build in; to a buyer they are a screen of nothing between
  // the last tile and the footer.
  const usedRows = useMemo(
    () => Math.min(theme.rows, Math.max(1, ...blocks.map((block) => block.y + block.h), bandsBottom(bands))),
    [blocks, theme.rows, bands],
  );

  return (
    <>
      <BoardMotion motion={theme.motion} />
      <StorefrontMasthead
        header={header ?? EMPTY_STOREFRONT_HEADER}
        theme={theme}
        logoUrl={page.logoUrl}
        logoAlt={tLayout("logoFallback", { store: displayName })}
        nav={menu}
        cart={headerCart}
      />
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
          narrowLayout={phone}
          underlays={underlays}
          assumedSize={assumedWidth ? { width: assumedWidth, gap: theme.gridGap } : undefined}
          // A block under a product on the same cells takes that card's
          // corners, exactly as it does on the canvas (blockTileClipStyle).
          cellStyle={(placement, gridBlock) =>
            gridBlock
              ? blockTileClipStyle(theme, gridBlock.data, placement, covers.get(gridBlock.key))
              : tileClipStyle(scaledCornerRadius(theme.cornerRadius, placement))
          }
          renderBlock={(gridBlock, state) => {
            const block = gridBlock.data;
            const tile = block.type === "product" ? tiles.get(block.productId) : undefined;
            const imageUrl = page.imageUrls[gridBlock.key] ?? null;
            // What the words are read against, where that is news: a band
            // under the block, or a kind new enough to ask.
            const backdrop = blockBackdrop(theme, bands, block, state.underlayKey);
            const drawFace = (quickAddAction?: TileQuickAddAction) => (
              <>
                <div className={TILE_FACE_CLASS} style={blockBlurStyle(block)}>
                  <BlockFace
                    block={block}
                    product={tile?.product ?? null}
                    theme={theme}
                    imageUrl={imageUrl}
                    look={page.tileLook}
                    quickAddAction={quickAddAction}
                    backdrop={backdrop}
                    carouselCards={carouselCards}
                  />
                </div>
                <BlockBlurCopies block={block} theme={theme} imageUrl={imageUrl} backdrop={backdrop} />
              </>
            );
            const card = block.type === "product" ? resolveCardStyle(theme, block.style) : null;
            const frameClassName = cn(
              tileFrameClass(block),
              // What the card does on hover (cardHoverFrameClass): the cell is
              // the group, the frame the thing that moves.
              card && cardHoverFrameClass(card.hoverEffect, "board"),
            );
            // A card that puts its product in the cart (the cart is here, the
            // seller's cards add to it, the product allows it, and the card
            // shows a buy button): its link goes under the face, and its
            // button is a button (QuickAddTile).
            if (tile?.product.quickAdd && block.type === "product" && addsToCart(tile, card?.buyButton)) {
              return (
                <QuickAddTile
                  href={tile.href}
                  newTab={tilesOpenNewTab}
                  frameClassName={frameClassName}
                  productId={block.productId}
                  optionIds={tile.product.quickAdd.optionIds}
                  title={tile.product.title}
                  renderFace={drawFace}
                />
              );
            }
            const face = drawFace();
            // A button is the way to wherever its link leads, resolved on the
            // server (page.links); the server already dropped one that leads
            // nowhere.
            const link = block.type === "button" ? page.links?.[buttonLinkKey(block)] : undefined;
            if (link) {
              return (
                <a
                  {...linkAnchorProps(link, { newTab: tilesOpenNewTab, pageUrl: page.url })}
                  className={cn(tileFrameClass(block), BOARD_LINK_FOCUS_CLASS)}
                  data-storefront-button={block.type === "button" ? block.id : undefined}
                >
                  {face}
                </a>
              );
            }
            // A product tile is the way to its page. Every other block is
            // part of the picture and leads nowhere.
            return tile ? (
              <a
                href={tile.href}
                // noreferrer as well as noopener: the new tab is handed
                // neither this window nor the address of the page it was on.
                {...(tilesOpenNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={cn(
                  frameClassName,
                  // The ring is the board's own ink, not the dashboard's grey:
                  // the ink is chosen to read on the seller's background, and
                  // the grey is 2.3:1 on a cream one, short of the 3:1 a focus
                  // indicator needs.
                  BOARD_LINK_FOCUS_CLASS,
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
