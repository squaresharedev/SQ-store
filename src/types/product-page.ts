import type { ProductPageProduct } from "@/types/product";
import type {
  ProductPageConfig,
  ShippingProfile,
  StorefrontHeader,
  StorefrontPolicies,
  StorefrontSeller,
  StorefrontTheme,
} from "@/types/storefront";

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
  policies: StorefrontPolicies;
  /** The store's named shipping exceptions. A product's `shippingProfileId`
   *  is resolved against THIS list, so a page always prints terms the store
   *  it is on actually offers. */
  shippingProfiles: ShippingProfile[];
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
