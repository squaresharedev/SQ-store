import type { Currency } from "@/types/product";
import type {
  StorefrontBlock,
  StorefrontHeader,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";

/**
 * What a buyer's browser is handed to draw a hosted storefront
 * (/s/[storefrontId]). Built field by field on the server
 * (lib/storefront/storefront-page.ts), like the product page's payload, so
 * nothing seller-private can ride along by default.
 */

/** A product as a TILE shows it, and no more: no stock numbers, no limits, no
 *  description, no object keys. */
export type StorefrontTileProduct = {
  id: string;
  title: string;
  /** Major currency units, as the tile prints it: what one costs RIGHT NOW,
   *  a running sale included. The same number the product page shows and the
   *  checkout charges (lib/discounts/public.ts). */
  price: number;
  /** The regular price, struck through beside `price`. Present exactly while
   *  a sale lowers the price. */
  regularPrice?: number;
  /** What the sale takes off `regularPrice`, in whole percent, for the
   *  tile's sale chip (ProductSale.offerPercent). Absent without a sale, or
   *  under 1%. */
  offerPercent?: number;
  currency: Currency;
  /** Signed, expiring URL for the tile's photo, or null for a placeholder. */
  imageUrl: string | null;
  /** Where the tile leads: the product's hosted page. */
  href: string;
};

export type StorefrontPageData = {
  id: string;
  /** The storefront's internal name; the header's own name wins where shown. */
  name: string;
  theme: StorefrontTheme;
  header?: StorefrontHeader;
  /** Only the blocks a buyer sees: hidden sold-out tiles and tiles whose
   *  product is not live are already gone. */
  blocks: StorefrontBlock[];
  products: StorefrontTileProduct[];
  /** Signed URLs for image blocks, by block key. A block with no entry draws
   *  nothing rather than a broken picture. */
  imageUrls: Record<string, string>;
  backgroundImageUrl: string | null;
  customFontUrl: string | null;
  /** The trader, for the footer's disclosure. */
  seller: StorefrontSeller;
  /** Whether a search engine may list the page (the product pages' own switch). */
  allowIndexing: boolean;
  /** The page's own absolute address. */
  url: string;
};
