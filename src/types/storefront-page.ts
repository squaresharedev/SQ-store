import type { Currency, ProductRating } from "@/types/product";
import type { TileStockState } from "@/types/stock";
import type { TileLook } from "@/lib/storefront/tile-look";
import type { ResolvedLink } from "@/lib/storefront/links";
import type {
  CartPageConfig,
  StorefrontBand,
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
  /** The card extras (lib/storefront/tile-extras.ts), each present only when
   *  its card shows it: the second photo shown on hover (signed), the buyers'
   *  rating once there is one, and the stock as a STATE, never a count. */
  hoverImageUrl?: string;
  rating?: ProductRating;
  stockState?: TileStockState;
  /** Where the tile leads: the product's hosted page. */
  href: string;
  /** The version the card's button puts straight in the cart (one option per
   *  group, or none), present only where it can: the cart is on here, the
   *  product needs no choice, and the checkout would sell one now
   *  (lib/cart/quick-add.ts). Absent: the card opens the product's page. */
  quickAdd?: { optionIds: string[] };
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
  /** What the cards borrow from the product page: the buy button's words and
   *  colours, the star colour, whether reviews show (resolveTileLook). */
  tileLook: TileLook;
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
  /** The storefront's cart, when buyers here have one (lib/cart/availability.ts
   *  cartFor). Absent otherwise. */
  cart?: CartPageConfig;
  /** The full-width bands behind the board's rows (config.bands), copied on
   *  purpose rather than spread with the config. Absent = none, which is every
   *  storefront saved before them. */
  bands?: StorefrontBand[];
  /** Signed URLs for band photos, by band id. A band photo with no entry draws
   *  its quiet placeholder rather than a broken picture. */
  bandImageUrls?: Record<string, string>;
  /** Where every link on the board goes, resolved on the server (lib/storefront/
   *  links.ts): by button block key, and `header-<n>` for the header menu. A
   *  button or menu entry whose link led nowhere a buyer may go was dropped
   *  before this payload was built. Absent = the board has no links. */
  links?: Record<string, ResolvedLink>;
  /** The header logo's signed URL. Absent = no logo, or one R2 could not sign. */
  logoUrl?: string;
};
