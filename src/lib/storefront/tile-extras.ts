import type { SupabaseClient } from "@supabase/supabase-js";
import { presignGetUrl } from "@/lib/r2";
import { parseGallery } from "@/lib/products/detail";
import { readRatingSummaries } from "@/lib/reviews/ratings";
import { PUBLIC_STOCK_SELECT, toPublicStockState, type PublicStockRow } from "@/lib/stock/public";
import { cardNeedsPhotoEdge, readPhotoEdge } from "@/lib/storefront/photo-edge";
import { resolveCardStyle, type StorefrontConfig } from "@/types/storefront";
import type { PhotoEdge, ProductRating } from "@/types/product";
import type { TileStockState } from "@/types/stock";

/**
 * THE CARD EXTRAS' ONE READ SIDE: the second photo, the stars, the stock
 * state and what is at the photo's edges, for every board a buyer or an
 * assistant is shown (the hosted page, the embed frame and the MCP preview all
 * come through here).
 *
 * Only what is SHOWN is fetched: a photo is signed for a card that shows it
 * on hover and nowhere else, ratings are read only for cards that print them
 * on a page that shows reviews, and a stock state only for cards that say
 * "Low stock". A board with none of the extras on reads and signs nothing
 * more than it did before they existed.
 *
 * The photo's edge (products.photo_edge, lib/storefront/photo-edge) is handed
 * only to a card whose look depends on it (an `auto` blend, a `shadow` title),
 * and only once the photo has been measured: a board with neither, or with no
 * photo measured yet, is handed exactly what it always was.
 */

/** The extra columns a board's product read carries for this. Stock through
 *  PUBLIC_STOCK_SELECT, the public seam's own list, never by hand. */
export const TILE_EXTRAS_SELECT = `gallery, photo_edge, ${PUBLIC_STOCK_SELECT}`;

/** Like TILE_EXTRAS_SELECT but without gallery: for boards where no tile asks
 *  for a hover photo, sparing the JSON column (up to 24 objects) from every
 *  product read. */
export const TILE_EXTRAS_SELECT_LEAN = `photo_edge, ${PUBLIC_STOCK_SELECT}`;

export type TileExtrasRow = PublicStockRow & {
  id: string;
  image_key: string | null;
  gallery: unknown;
  /** products.photo_edge: read through readPhotoEdge, never as it is. */
  photo_edge?: string | null;
};

/** What one card is handed beyond its price and photo. */
export type TileExtras = {
  hoverImageUrl?: string;
  rating?: ProductRating;
  stockState?: TileStockState;
  photoEdge?: PhotoEdge;
};

/** Which products' cards ask for which extra, from each tile's resolved style
 *  (the theme's card settings with the tile's own laid on top). */
export type TileExtrasWanted = {
  hoverPhoto: ReadonlySet<string>;
  rating: ReadonlySet<string>;
  stock: ReadonlySet<string>;
  photoEdge: ReadonlySet<string>;
};

export function tileExtrasWanted(config: Pick<StorefrontConfig, "theme" | "blocks">): TileExtrasWanted {
  const hoverPhoto = new Set<string>();
  const rating = new Set<string>();
  const stock = new Set<string>();
  const photoEdge = new Set<string>();
  for (const block of config.blocks) {
    if (block.type !== "product") continue;
    const card = resolveCardStyle(config.theme, block.style);
    if (card.hoverPhoto) hoverPhoto.add(block.productId);
    if (card.showRating) rating.add(block.productId);
    // The buy button needs the state too: it is not offered once none are left.
    if (card.showLowStock || card.buyButton !== "none") stock.add(block.productId);
    if (cardNeedsPhotoEdge(card)) photoEdge.add(block.productId);
  }
  return { hoverPhoto, rating, stock, photoEdge };
}

/**
 * The photo a card shows on hover: the first one in the product's gallery
 * that every version shares, else its first photo of any version. The cover
 * is not in the gallery, so this is always a DIFFERENT picture.
 */
export function secondPhotoKey(gallery: unknown): string | null {
  const photos = parseGallery(gallery);
  return (photos.find((photo) => !photo.optionId) ?? photos[0])?.key ?? null;
}

export async function loadTileExtras(
  client: Pick<SupabaseClient, "from">,
  rows: readonly TileExtrasRow[],
  wanted: TileExtrasWanted,
  options: { reviewsShown: boolean; context: string },
): Promise<Map<string, TileExtras>> {
  const ratingIds = options.reviewsShown ? rows.filter((row) => wanted.rating.has(row.id)).map((row) => row.id) : [];
  const [ratings, entries] = await Promise.all([
    readRatingSummaries(client, ratingIds, options.context),
    Promise.all(
      rows.map(async (row): Promise<[string, TileExtras]> => {
        // A second photo needs a first: a product with no cover keeps its
        // placeholder rather than showing a photo only on hover.
        const hoverKey = wanted.hoverPhoto.has(row.id) && row.image_key ? secondPhotoKey(row.gallery) : null;
        // A photo R2 cannot sign for is left out, and the card keeps its one.
        const hoverImageUrl = hoverKey ? await presignGetUrl(hoverKey) : null;
        const stockState = wanted.stock.has(row.id) ? toPublicStockState(row) : null;
        const photoEdge = wanted.photoEdge.has(row.id) ? readPhotoEdge(row) : undefined;
        return [
          row.id,
          {
            ...(hoverImageUrl ? { hoverImageUrl } : {}),
            ...(stockState ? { stockState } : {}),
            ...(photoEdge ? { photoEdge } : {}),
          },
        ];
      }),
    ),
  ]);
  return new Map(
    entries.map(([id, extras]) => {
      const rating = ratings.get(id);
      return [id, rating ? { ...extras, rating } : extras];
    }),
  );
}
