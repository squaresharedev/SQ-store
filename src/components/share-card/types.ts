import type { CutoutPhoto } from "@/lib/share-card/cutout/store";
import type { Currency, ProductTileSale } from "@/types/product";

/** What a share card says about a product: everything it prints, resolved by
 *  the caller (the dev gallery's fixtures, or a seller's real product). */
export type ShareCardProduct = {
  title: string;
  /** The regular price, in major currency units. */
  price: number;
  currency: Currency;
  /** While a sale lowers the price: what one costs now, and by how much. */
  sale?: ProductTileSale | null;
  /** The photo as shown (it may be on another origin). */
  imageUrl: string | null;
  /** The same photo where its pixels can be READ (same origin), for cutting
   *  the product out of it; null when there is no photo. */
  photo: CutoutPhoto | null;
  /** Nothing left to sell: the card says so instead of a sale. */
  soldOut: boolean;
  /** The seller's store, as buyers know it. */
  storeName: string;
  /** Where a buyer lands, the hosted product page: the QR code's target. */
  url: string;
  /** The same address, short enough to print on the card. */
  urlLabel: string;
};
