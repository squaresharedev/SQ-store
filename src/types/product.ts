// The Product feature contract. Mock data, forms, and (in a later stage) the
// Supabase rows all share this shape, so the wiring stage can swap the data
// source without touching component props.

/** Lifecycle of a product. `draft` is hidden from buyers; `active` is live. */
export const PRODUCT_STATUSES = ["draft", "active"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** EUR is primary, USD secondary, per our market focus. */
export const CURRENCIES = ["EUR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Product {
  id: string;
  title: string;
  description: string;
  /** Price in major currency units (e.g. `12.5` renders as €12.50). */
  price: number;
  currency: Currency;
  status: ProductStatus;
  /**
   * Display image for the storefront card. Bytes live in R2 under the row's
   * `image_key`; this stays `null` (placeholder tile) until the image read
   * path (public/CDN or signed GET) is built.
   */
  imageUrl: string | null;
  /**
   * Display name of the digital file the buyer downloads after purchase,
   * derived from the row's `digital_file_key`. `null` until one is uploaded.
   */
  digitalFileName: string | null;
  /** Stock tracking is opt-in per product; false = unlimited (no badge). */
  trackStock: boolean;
  /** Units on hand. Set (>= 0) whenever `trackStock`; null when not tracking. */
  stockQuantity: number | null;
  /** At or below this remaining count the public badge shows "Only N left". */
  lowStockThreshold: number;
}

/**
 * The editable text fields captured by the form. Kept separate from `Product`
 * because `price` is an in-progress input string here (validated + parsed to a
 * number on submit), and uploads are tracked as `File` objects in local state
 * rather than on this object.
 */
export interface ProductFormValues {
  title: string;
  description: string;
  price: string;
  currency: Currency;
  status: ProductStatus;
  trackStock: boolean;
  /** In-progress input strings, parsed + validated on submit like `price`. */
  stockQuantity: string;
  lowStockThreshold: string;
}

// The write payload lives in lib/validation/product.ts as `ProductWriteInput`
// (Zod-inferred), so client and server validate against one schema.
