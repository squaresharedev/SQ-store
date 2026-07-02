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
   * Display image shown on the storefront card. `null` until one is uploaded
   * (rendered as a placeholder tile). A later stage replaces this with the R2
   * object URL.
   */
  imageUrl: string | null;
  /**
   * Name of the digital file the buyer downloads after purchase. `null` until
   * one is uploaded. The bytes themselves live in R2 (wired later); the row
   * only stores the display name / key.
   */
  digitalFileName: string | null;
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
}

/**
 * The shape the form would send to the API in a later stage. Uploads are
 * referenced by name only here; the actual bytes go to R2 out of band. This is
 * the object the current UI-only stage logs on submit instead of calling an API.
 */
export interface ProductDraftPayload {
  /** `null` when creating, the existing id when editing. */
  id: string | null;
  title: string;
  description: string;
  price: number;
  currency: Currency;
  status: ProductStatus;
  hasNewImage: boolean;
  imageFileName: string | null;
  hasNewDigitalFile: boolean;
  digitalFileName: string | null;
}
