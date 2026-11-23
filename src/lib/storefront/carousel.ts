import {
  CANVAS_COLUMNS_MIN,
  CAROUSEL_PRODUCTS_MAX,
  type BlockPlacement,
  type CarouselBlock,
  type StorefrontBlock,
} from "@/types/storefront";

/**
 * THE PRODUCT CAROUSEL (CarouselBlock), as pure rules: what a new one is, how
 * its list of products is edited, and how a board sheds a product it may no
 * longer show. The face is components/storefront/CarouselTileContent, its
 * panel CarouselBlockEditor.
 *
 * A carousel shows products that are NOT product blocks, and this app decides
 * what a buyer may see and buy by which products a storefront shows
 * (boardProductIds). So every place that drops a product from a board (the
 * save's ownership check, the buyer's payload, the assistant's preview) drops
 * it through keepProducts below, and a carousel loses that member exactly as a
 * product block would be lost whole.
 */

/** How many rows a new carousel takes: two, so its cards are as tall as a
 *  2 by 2 product card, and a 6 column board shows three of them. */
export const CAROUSEL_NEW_ROWS = 2;

/** How many products a carousel starts with when one is inserted. */
export const CAROUSEL_STARTING_PRODUCTS = 6;

/** How big a new carousel lands: the board's full width (a board is never
 *  narrower than CANVAS_COLUMNS_MIN, 3) and CAROUSEL_NEW_ROWS tall. */
export function carouselInsertSize(columns: number): { w: number; h: number } {
  return { w: Math.max(CANVAS_COLUMNS_MIN, columns), h: CAROUSEL_NEW_ROWS };
}

/** A list of products as a carousel holds it: each once, in the order given,
 *  at most CAROUSEL_PRODUCTS_MAX. */
export function carouselProductList(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, CAROUSEL_PRODUCTS_MAX);
}

/** A new carousel holding `productIds` (each once, capped). */
export function newCarouselBlock(id: string, placement: BlockPlacement, productIds: readonly string[]): CarouselBlock {
  return { type: "carousel", id, productIds: carouselProductList(productIds), ...placement };
}

/**
 * What a new carousel starts with, from the catalogue in its own order
 * (newest first): live products the board does not show yet, then live ones
 * it does; drafts only when there is nothing live, so the seller still sees a
 * row to work on. Empty when the store has no products, and then there is
 * nothing to insert.
 */
export function startingCarouselProducts(
  catalog: readonly { id: string; status: string }[],
  onBoard: ReadonlySet<string>,
): string[] {
  const live = catalog.filter((product) => product.status === "active");
  const pool = live.length > 0 ? live : catalog;
  const fresh = pool.filter((product) => !onBoard.has(product.id));
  const shown = pool.filter((product) => onBoard.has(product.id));
  return carouselProductList([...fresh, ...shown].map((product) => product.id)).slice(0, CAROUSEL_STARTING_PRODUCTS);
}

/** A carousel holding `productIds` instead (each once, capped). An empty list
 *  is the caller's to refuse: a carousel always holds one product. */
export function withCarouselProducts(block: CarouselBlock, productIds: readonly string[]): CarouselBlock {
  return { ...block, productIds: carouselProductList(productIds) };
}

/** The list with the product at `index` moved `by` places (clamped to the
 *  list). The same list when it cannot move. */
export function moveCarouselProduct(ids: readonly string[], index: number, by: number): string[] {
  const to = Math.min(ids.length - 1, Math.max(0, index + by));
  if (index < 0 || index >= ids.length || to === index) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * THE BOARD WITH ONLY THE PRODUCTS `keep` ADMITS: a product block naming any
 * other goes whole, a carousel loses those members, and a carousel left with
 * none goes too. Every other block is untouched.
 *
 * The one way a board sheds a product: the save's ownership check (a product
 * that is not this store's, or was deleted while the editor was open), the
 * buyer's payload (a product that is not live) and the assistant's preview.
 * Returns the very same array when nothing went, so a board without a change
 * keeps its identity (and a stored config its bytes).
 */
export function keepProducts<T extends StorefrontBlock>(blocks: readonly T[], keep: (productId: string) => boolean): T[] {
  let changed = false;
  const kept: T[] = [];
  for (const block of blocks) {
    if (block.type === "product") {
      if (keep(block.productId)) kept.push(block);
      else changed = true;
    } else if (block.type === "carousel") {
      const members = block.productIds.filter(keep);
      if (members.length === block.productIds.length) kept.push(block);
      else {
        changed = true;
        if (members.length > 0) kept.push({ ...block, productIds: members });
      }
    } else kept.push(block);
  }
  return changed ? kept : (blocks as T[]);
}
