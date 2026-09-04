// The Product feature contract. Mock data, forms, and (in a later stage) the
// Supabase rows all share this shape, so the wiring stage can swap the data
// source without touching component props.

import type { StockBadge } from "@/types/stock";

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

// ── Product page detail ─────────────────────────────────────────────────
//
// What a product carries beyond the tile: extra photos, the option groups that
// swap those photos, and the specification and compliance facts a product page
// must show. Stored as bounded jsonb on the row (see lib/validation/product.ts
// for every cap); these are the parsed shapes.

export const GALLERY_MAX = 24;
export const SPECS_MAX = 30;
export const INCLUDED_MAX = 20;
export const GALLERY_ALT_MAX = 160;
export const DOCUMENTS_MAX = 8;
export const DOCUMENT_LABEL_MAX = 80;

// ── Options ─────────────────────────────────────────────────────────────
//
// A product is sold in versions, and what separates them is the SELLER's
// business: colour for a shirt, power output for a motor, capacity for a
// battery, length for a cable. So the axis itself is data — a named group with
// its own list of choices — rather than a hard-coded "colour" field. A product
// carries up to OPTION_GROUPS_MAX of them and a buyer picks one choice per
// group; photos are tied to a choice so the picture follows the pick.
//
// WHAT THIS IS NOT: a per-combination price or stock model. Every option is
// the same product at the same price; the shape below could not express
// anything else. A priced, separately-stocked SKU is a table, not a blob, and
// it earns one when it is actually needed (see the migration's note).

export const OPTION_GROUPS_MAX = 4;
export const OPTIONS_PER_GROUP_MAX = 24;
/** Across every group. Bounds the jsonb, the picker, and the number of
 *  distinct ids a photo tie or a `?o=` parameter can name. */
export const OPTIONS_TOTAL_MAX = 48;
export const OPTION_GROUP_NAME_MAX = 32;
export const OPTION_NAME_MAX = 40;

/**
 * How a group's choices are drawn on the product page.
 *
 *   swatch — colour circles, the name printed beside the label. For anything
 *            with a colour; falls back to the initial when no swatch is set.
 *   chip   — text pills. The default for everything else, because "750 W" and
 *            "XL" are words, not colours.
 *   select — a dropdown, for a long list that would wrap into a wall of pills.
 */
export const OPTION_DISPLAYS = ["swatch", "chip", "select"] as const;
export type OptionDisplay = (typeof OPTION_DISPLAYS)[number];

/** One choice within a group: "Midnight blue", "XL", "750 W". Ids are
 *  client-minted uuids, unique across the WHOLE product, because a photo tie
 *  and the `?o=` parameter name an option and nothing else. */
export interface ProductOption {
  id: string;
  name: string;
  /** Strict #rrggbb swatch; absent = the name's initial in a neutral chip.
   *  Only drawn when the group displays as swatches. */
  swatch?: string;
  available: boolean;
}

/** One axis a product varies along, with the choices along it. */
export interface ProductOptionGroup {
  id: string;
  /** What the axis is called on the page: "Colour", "Power output", "Length". */
  name: string;
  display: OptionDisplay;
  options: ProductOption[];
}

export const DIMENSION_UNITS = ["mm", "cm", "in"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];
export const WEIGHT_UNITS = ["g", "kg", "oz", "lb"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/**
 * One extra photo. `key` is an R2 object key under the uploader's prefix;
 * `optionId` ties it to ONE option, from any group, and absent means it shows
 * whatever is picked.
 *
 * ONE tie, not a combination, and that is a deliberate ceiling. A photo tied
 * to "Blue" shows whenever blue is picked, whatever size is picked with it,
 * which is how product photography actually works: the axes that change the
 * picture (colour, finish, length) are not the axes that do not (size). Tying
 * to a combination would multiply the photos a seller has to shoot and upload
 * by every axis they added, for a case almost nobody has.
 */
export interface GalleryImage {
  key: string;
  alt: string;
  optionId?: string;
}

export interface ProductDimensions {
  length?: number;
  width?: number;
  height?: number;
  unit: DimensionUnit;
}

export interface ProductWeight {
  value: number;
  unit: WeightUnit;
}

export interface ProductSpec {
  label: string;
  value: string;
}

/**
 * A named file: a certificate of conformity, a safety data sheet, a manual, a
 * spec sheet — whatever a regulated or technical product needs to show buyers
 * (and regulators) BEFORE purchase, publicly, not gated behind checkout the
 * way `digitalFileKey` is. `key` is an R2 object key under the files/ prefix,
 * validated and owned the same way the digital-download file is.
 */
export interface ProductDocument {
  key: string;
  label: string;
}

/**
 * The General Product Safety Regulation block for physical goods sold at a
 * distance: who made it, how to reach them, who answers for it in the EU when
 * the maker is outside, how to identify the item, and any warnings.
 */
export interface ProductSafety {
  manufacturerName: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  responsibleName?: string;
  responsibleAddress?: string;
  responsibleEmail?: string;
  /** Type, batch or serial number. */
  identifier?: string;
  warnings?: string;
}

export interface ProductDetails {
  dimensions?: ProductDimensions;
  weight?: ProductWeight;
  materials?: string;
  care?: string;
  /** "What's in the box", one line per item. */
  included?: string[];
  specs?: ProductSpec[];
  /** Country of origin, free text. */
  origin?: string;
  safety?: ProductSafety;
}

/** The owner-side full product: everything on `Product` plus the page facts,
 *  with each gallery key (and each document key) already signed for display. */
export interface ProductDetail extends Product {
  gallery: (GalleryImage & { url: string | null })[];
  optionGroups: ProductOptionGroup[];
  details: ProductDetails;
  documents: (ProductDocument & { url: string | null })[];
  /** Where the buy button goes. https only; null = no link set. */
  purchaseUrl: string | null;
  /** Which of the storefront's named shipping profiles this product ships
   *  under. Null = the store's default terms, which is the common case. */
  shippingProfileId: string | null;
}

/** A displayable product photo: signed URL, alt, optional option tie. */
export interface ProductPageImage {
  url: string;
  alt: string;
  optionId?: string;
}

/** A displayable document: signed URL, the seller's own label, and the
 *  extension only ("PDF") for the icon/badge — never the filename or key. */
export interface ProductPageDocument {
  url: string;
  label: string;
  format: string | null;
}

/**
 * The BUYER-SAFE product, and the only product shape that leaves the server
 * for a non-owner. Built by one function (lib/products/public.ts) that the
 * public page and the editor preview both call, so what a buyer may see is
 * decided in exactly one place. Never carries R2 keys, the digital file, or a
 * raw stock number.
 */
export interface ProductPageProduct {
  id: string;
  title: string;
  description: string;
  /** Integer cents; formatting happens at the edge. */
  priceCents: number;
  currency: Currency;
  purchaseUrl: string | null;
  /** Which of the rendering storefront's shipping profiles applies, or null
   *  for its default terms. An id the storefront does not have resolves to the
   *  default too — see lib/storefront/shipping.ts. Not a secret: it is an
   *  opaque reference to text the same page already prints. */
  shippingProfileId: string | null;
  /** Cover first, then the gallery in the seller's order. */
  images: ProductPageImage[];
  /** The axes this product is sold along, in the seller's order. Empty for a
   *  product sold in one version, which is most of them. */
  optionGroups: ProductOptionGroup[];
  details: ProductDetails;
  /** Certificates, manuals, spec sheets — public, not purchase-gated. */
  documents: ProductPageDocument[];
  /** True when the product is a download. Shipping and safety sections do
   *  not apply; a "Digital download" line does. */
  isDigital: boolean;
  /** Upper-case extension of the download ("PDF"), never its key or name. */
  digitalFormat: string | null;
  /** Derived badge, or null when the product does not track stock. */
  stock: StockBadge | null;
  /** The tile's manual flag OR a sold-out badge. */
  soldOut: boolean;
}

/**
 * Sales rollup for ONE product, derived from paid orders. Deliberately kept
 * off `Product`: the form, mocks, and write path have no business carrying
 * revenue, and a product with zero sales simply has no entry.
 */
export interface ProductSales {
  /** Paid orders referencing this product. */
  unitsSold: number;
  /** Gross paid revenue, integer cents (never floats). */
  revenueCents: number;
  /** Currency of those orders; falls back to the product's own currency. */
  currency: Currency;
}

/** Per-product sales keyed by product id, plus the single best seller. */
/**
 * Server-side filters for the products list. Every field is optional and
 * absent means "no constraint"; the query layer trims and escapes `search`
 * before it reaches the database.
 */
export interface ProductFilters {
  /** Case-insensitive substring match on the product title. */
  search?: string;
  /** Exact lifecycle match. */
  status?: ProductStatus;
}

export interface ProductSalesSummary {
  byProduct: Record<string, ProductSales>;
  /** Highest-revenue product that has at least one paid sale; null if none. */
  bestsellerId: string | null;
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
