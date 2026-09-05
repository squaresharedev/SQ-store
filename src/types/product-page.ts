import type { ProductPageProduct } from "@/types/product";
import type {
  ProductPageConfig,
  StorefrontHeader,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

// What a product page RENDERS. Client-safe types only: the public loader
// (lib/products/public.ts) builds one of these for a buyer, and the editor
// preview builds one from the seller's live edits, so the view component has
// a single contract and no server import.

export type ProductPageStorefront = {
  id: string;
  name: string;
  theme: StorefrontTheme;
  header?: StorefrontHeader;
  productPage: ProductPageConfig;
  /**
   * The ACCOUNT's shipping and returns terms, including the named shipping
   * exceptions a product's `shippingProfileId` resolves against. One object
   * where there used to be two storefront config members, because a storefront
   * is a presentation of one catalogue rather than a business and never had a
   * second answer to give. Read from `profiles.shipping_policy`; see
   * lib/settings/shipping-policy.ts.
   */
  shippingPolicy: SellerShippingPolicy;
  seller: StorefrontSeller;
  /** Signed URL for an image background, else null. */
  backgroundImageUrl: string | null;
  /** Signed URL for the uploaded typeface, else null. */
  customFontUrl: string | null;
};

export type ProductPageData = {
  storefront: ProductPageStorefront;
  product: ProductPageProduct;
  /** The page's own canonical URL. */
  productUrl: string;
};
