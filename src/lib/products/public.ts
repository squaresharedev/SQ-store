// SERVER ONLY. The public product read: the ONE place that decides what a
// buyer may see of a product, used by the hosted product page and by the
// editor's preview action so the two can never disagree.
//
// SECURITY MODEL, same as /api/embed/[key]: a service-role read behind an
// application gate, never an anon RLS policy. The gate, in order: both ids
// must be UUIDs before any I/O; the client IP spends a rate-limit token; the
// storefront must exist and have its product page switched on; the product
// must be PLACED on that storefront; the product must be `active` and owned by
// the storefront's owner. Every failure is the same `null`, which the route
// turns into the same 404, so nothing here is enumerable.
//
// The payload is BUILT field by field, never spread. That is what keeps
// digital_file_key, owner_id, raw stock numbers and R2 keys out of a buyer's
// hands by default rather than by remembering to strip them.

import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SELLER_IDENTITY_SELECT,
  buildSellerIdentity,
  type SellerIdentityRow,
} from "@/lib/settings/seller-identity";
import {
  SHIPPING_POLICY_SELECT,
  buildShippingPolicy,
  type ShippingPolicyRow,
} from "@/lib/settings/shipping-policy";
import { presignGetUrl } from "@/lib/r2";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { uuidField } from "@/lib/validation/inputs";
import { purchaseUrlSchema } from "@/lib/validation/product";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { PUBLIC_STOCK_SELECT, toPublicStockBadge } from "@/lib/stock/public";
import {
  parseDetails,
  parseDocuments,
  parseGallery,
  parseOptionGroups,
  reconcileGalleryOptions,
} from "@/lib/products/detail";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { toCurrency } from "@/lib/format/money";
import type {
  ProductPageDocument,
  ProductPageImage,
  ProductPageProduct,
} from "@/types/product";
import type { ProductPageData } from "@/types/product-page";

/**
 * Exactly the columns the builder reads. `digital_file_key` is here ONLY so
 * `isDigital` and the format can be derived; it never leaves this module.
 * The stock fragment comes from the stock seam so this select cannot drift
 * onto a column that seam has not admitted.
 */
export const PUBLIC_PRODUCT_SELECT =
  `id, title, description, price_cents, currency, image_key, digital_file_key, gallery, option_groups, details, documents, purchase_url, shipping_profile_id, ${PUBLIC_STOCK_SELECT}` as const;

export type PublicProductRow = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_key: string | null;
  digital_file_key: string | null;
  gallery: unknown;
  option_groups: unknown;
  details: unknown;
  documents: unknown;
  purchase_url: string | null;
  shipping_profile_id: string | null;
  track_stock: boolean;
  stock_quantity: number | null;
  low_stock_threshold: number;
};

/** "PDF", "ZIP"... from a key's extension. Never the name, never the key. */
function formatFromKey(key: string | null): string | null {
  if (!key) return null;
  const lastSegment = key.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) return null;
  const extension = lastSegment.slice(dot + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : null;
}

/**
 * The buyer-safe product from a raw row. `soldOutFlag` is the tile's manual
 * flag on the storefront that linked here; the derived badge can also say
 * sold out on its own.
 */
export async function buildProductPageProduct(
  row: PublicProductRow,
  options: { soldOutFlag?: boolean } = {},
): Promise<ProductPageProduct> {
  const optionGroups = parseOptionGroups(row.option_groups);
  const gallery = reconcileGalleryOptions(parseGallery(row.gallery), optionGroups);

  const images: ProductPageImage[] = [];
  if (row.image_key) {
    const url = await presignGetUrl(row.image_key);
    if (url) images.push({ url, alt: row.title });
  }
  for (const image of gallery) {
    const url = await presignGetUrl(image.key);
    if (!url) continue;
    images.push({
      url,
      alt: image.alt || row.title,
      ...(image.optionId ? { optionId: image.optionId } : {}),
    });
  }

  // Re-gated on the way out: the schema is the write boundary, but a stored
  // value is trusted exactly as far as it still passes the same rule.
  const purchaseUrl =
    row.purchase_url && purchaseUrlSchema.safeParse(row.purchase_url).success
      ? row.purchase_url
      : null;

  // Certificates, manuals, spec sheets. Public and unconditional — unlike the
  // digital download, these are not the paywall, so every one that signs
  // successfully ships; one that fails to sign is dropped rather than shown
  // as a dead link.
  const documents: ProductPageDocument[] = [];
  for (const document of parseDocuments(row.documents)) {
    const url = await presignGetUrl(document.key);
    if (!url) continue;
    documents.push({ url, label: document.label, format: formatFromKey(document.key) });
  }

  const stock = toPublicStockBadge(row);

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    priceCents: row.price_cents,
    currency: toCurrency(row.currency),
    purchaseUrl,
    // A REFERENCE, not terms. The words it resolves to are the storefront's
    // own, which this page already carries; what crosses here is only which
    // set of them applies (see lib/storefront/shipping.ts).
    shippingProfileId: row.shipping_profile_id,
    images,
    optionGroups,
    details: parseDetails(row.details),
    documents,
    isDigital: row.digital_file_key !== null,
    digitalFormat: formatFromKey(row.digital_file_key),
    stock,
    soldOut: Boolean(options.soldOutFlag) || stock?.state === "sold_out",
  };
}

/** Everything the page renders. No owner id, no embed settings, no keys. */
export type PublicProductPage = ProductPageData;

/**
 * The store name a buyer should see in metadata and share cards.
 *
 * Precedence: legal business name > buyer-facing header name > internal row
 * name. Matches the order `SellerBlock` uses for its own heading, so the
 * metadata and the on-page identity can never disagree about whose name this
 * is. The function is a named export so it can be tested independently of the
 * full page load.
 */
export function resolveDisplayName(page: PublicProductPage): string {
  const { storefront } = page;
  if (storefront.seller.businessName) return storefront.seller.businessName;
  if (storefront.header?.show && storefront.header.name) return storefront.header.name;
  return storefront.name;
}

export type PublicProductPageResult = {
  page: PublicProductPage;
  /** For the view signal only. Never placed on `page`. */
  ownerId: string;
};

const idSchema = uuidField();

/**
 * Load a product page for a buyer, or `null` for every reason it cannot be
 * shown. Wrapped in React's `cache` so generateMetadata and the page body share
 * one read (and one rate-limit token) per request.
 */
export const getPublicProductPage = cache(
  async (
    storefrontId: string,
    productId: string,
  ): Promise<PublicProductPageResult | null> => {
    if (!idSchema.safeParse(storefrontId).success) return null;
    if (!idSchema.safeParse(productId).success) return null;

    // The budget is spent before the first read, so a scan pays before it
    // learns anything. rateLimitKey fails closed.
    const key = await clientKey(await headers());
    if (!(await rateLimitKey(key, "product_page", RATE_LIMITS.productPage))) {
      return null;
    }

    const admin = createAdminClient();
    const { data: storefront, error: storefrontError } = await admin
      .from("storefronts")
      .select("id, name, owner_id, config")
      .eq("id", storefrontId)
      .maybeSingle();
    if (storefrontError) {
      console.error("[product-page] storefront read failed", storefrontError);
      return null;
    }
    if (!storefront) return null;

    const config = parseStoredStorefrontConfig(storefront.config);
    if (!config) return null;
    const productPage = resolveProductPage(config);
    if (!productPage.enabled) return null;

    // The page belongs to a tile. A product the seller has not placed on this
    // storefront has no page here, whatever its status. Hidden sold-out tiles
    // still count: the page then simply says sold out.
    const block = config.blocks.find(
      (candidate) => candidate.type === "product" && candidate.productId === productId,
    );
    if (!block || block.type !== "product") return null;

    // Product and seller identity both depend only on the owner id already in
    // hand, so they run together rather than one after the other.
    const [
      { data: row, error: productError },
      { data: sellerRow, error: sellerError },
    ] = await Promise.all([
      admin
        .from("products")
        .select(PUBLIC_PRODUCT_SELECT)
        .eq("id", productId)
        .eq("owner_id", storefront.owner_id)
        .eq("status", "active")
        .maybeSingle(),
      admin
        .from("profiles")
        // Trader identity AND shipping terms, in ONE select: both are
        // account-level facts read off the same row, and asking for that row
        // twice on the public page's hot path would be two round trips for
        // one read.
        .select(`${SELLER_IDENTITY_SELECT}, ${SHIPPING_POLICY_SELECT}`)
        .eq("id", storefront.owner_id)
        .maybeSingle(),
    ]);
    if (productError) {
      console.error("[product-page] product read failed", productError);
      return null;
    }
    if (!row) return null;
    // A seller-identity read failure is NOT a reason to 404 the page: the
    // block degrades to "nothing set", same as an owner who never filled it
    // in — see buildSellerIdentity(null).
    if (sellerError) {
      console.error("[product-page] seller identity read failed", sellerError);
    }

    const product = await buildProductPageProduct(row as PublicProductRow, {
      soldOutFlag: block.soldOut,
    });

    const theme = config.theme;
    const backgroundImageUrl =
      theme.background.kind === "image" ? await presignGetUrl(theme.background.key) : null;
    const customFontUrl = theme.customFont ? await presignGetUrl(theme.customFont.key) : null;

    return {
      page: {
        storefront: {
          id: storefront.id,
          name: storefront.name,
          theme,
          ...(config.header ? { header: config.header } : {}),
          productPage,
          shippingPolicy: buildShippingPolicy(
            sellerError ? null : (sellerRow as ShippingPolicyRow | null),
          ),
          seller: buildSellerIdentity(sellerError ? null : (sellerRow as SellerIdentityRow | null)),
          backgroundImageUrl,
          customFontUrl,
        },
        product,
        productUrl: productPageUrl(storefront.id, product.id),
      },
      ownerId: storefront.owner_id,
    };
  },
);
