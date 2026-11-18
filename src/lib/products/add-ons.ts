// SERVER ONLY. "Add to your order": which of a product's add-ons a buyer may
// be offered right now, and at what price.
//
// Called AFTER the main product's gate (lib/products/purchasable.ts) has passed,
// by the product page, the editor preview, the checkout page and the quote, so
// all four offer and price the same add-ons. The rules:
//
//   * the SAME STORE's product (owner_id), active, not taken down;
//   * the same KIND as the main product (posted with posted, a download with
//     downloads), because one order is sent one way;
//   * the same CURRENCY, because one order is charged in one;
//   * not sold out.
//
// The last four are lib/products/add-on-visibility.ts, the one rule every
// preview shares.
//
// An add-on does NOT need a tile on the storefront: the seller choosing it for
// this product is what puts it on sale here, and gives it a page here too.
//
// Every card is built by buildProductPageProduct (the ONE builder) and narrowed
// to AddOnCard, so a card can never carry anything the page's own product does
// not. No rate-limit token is spent: the caller's gate already spent one.

import type { createAdminClient } from "@/lib/supabase/admin";
import { isContentVisible } from "@/lib/moderation/removal";
import { toPublicStockBadge } from "@/lib/stock/public";
import { toCurrency } from "@/lib/format/money";
import { parseAddOnIds, parseOptionGroups } from "@/lib/products/detail";
import { addOnHiddenReason } from "@/lib/products/add-on-visibility";
import { PUBLIC_PRODUCT_SELECT, type PublicProductRow } from "@/lib/products/purchasable";
import { presignGetUrl } from "@/lib/r2";
import { loadProductSales, readStoreSales, salesCovering, type ProductPricing } from "@/lib/discounts/public";
import type { ActiveSale, StoreSale } from "@/types/discount";
import { PAGE_BUSY, type PageBusy } from "@/lib/public/busy";
import { productPagePath } from "@/lib/storefront/product-page-url";
import type { AddOnCard, Currency, ProductPageImage, ProductRating } from "@/types/product";
import { readRatingSummaries } from "@/lib/reviews/ratings";

type Admin = ReturnType<typeof createAdminClient>;

/** "PDF", "ZIP"... from a key's extension. Same logic as formatFromKey in
 *  lib/products/public.ts; duplicated here to avoid exporting a private
 *  function from that module. */
function fileFormatFromKey(key: string | null): string | null {
  if (!key) return null;
  const lastSegment = key.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) return null;
  const extension = lastSegment.slice(dot + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : null;
}

/**
 * A lean add-on card built from a raw row and its pricing. Signs only the
 * cover image (no gallery, no documents), which is all an add-on card shows.
 * Pass `lean = true` to skip signing entirely for callers (the quote) that
 * use only optionGroups and never render images.
 */
async function buildLeanAddOnCard(
  row: PublicProductRow,
  pricing: ProductPricing | undefined,
  pagePath: string | null,
  rating: ProductRating | null,
  lean?: boolean,
): Promise<AddOnCard> {
  const images: ProductPageImage[] = [];
  if (!lean && row.image_key) {
    const url = await presignGetUrl(row.image_key);
    if (url) images.push({ url, alt: row.title });
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    priceCents: pricing?.priceCents ?? row.price_cents,
    currency: toCurrency(row.currency),
    sale: pricing?.sale ?? null,
    images,
    optionGroups: parseOptionGroups(row.option_groups),
    isDigital: row.digital_file_key !== null,
    digitalFormat: fileFormatFromKey(row.digital_file_key),
    shippingProfileId: row.shipping_profile_id,
    pagePath,
    rating,
  };
}

/** One add-on a buyer may be offered: the card for the page, and (server side
 *  only) what the quote prices it from. */
export type AddOnLine = {
  card: AddOnCard;
  row: PublicProductRow;
  /** The running sales that cover it, for the quote's bestSale. */
  sales: ActiveSale[];
};

export async function loadAddOns(
  admin: Admin,
  input: {
    ownerId: string;
    /** The main product's products.add_on_ids, or the subset a buyer asked for. */
    ids: unknown;
    isDigital: boolean;
    currency: Currency;
    now: Date;
    /**
     * When the store's sales cannot be read. A buyer's page and the quote say
     * "not right now" (the price is not known, see lib/discounts/public.ts);
     * the seller's preview shows the regular price instead.
     */
    unreadableSales: "busy" | "regular";
    /** Which add-ons have a page of their own on this storefront, and where.
     *  Absent = no links (the checkout, the quote, the editor's preview). */
    pages?: { storefrontId: string; linked: (productId: string) => boolean };
    /** Read their reviews' numbers too, for a page that shows them. */
    withRatings?: boolean;
    /** Store-wide sales already read by the caller's gate; skips a second
     *  read of readStoreSales for the same owner and time. `undefined` means
     *  "not provided, read them here"; `null` means "read failed". */
    storeSales?: StoreSale[] | null;
    /** Skip signing images entirely (cover and gallery). The quote uses
     *  `lean: true` because it only needs optionGroups, never images. */
    lean?: boolean;
  },
): Promise<AddOnLine[] | PageBusy> {
  const ids = parseAddOnIds(input.ids);
  if (ids.length === 0) return [];

  const [{ data, error }, storeSales] = await Promise.all([
    admin
      .from("products")
      .select(PUBLIC_PRODUCT_SELECT)
      .in("id", ids)
      .eq("owner_id", input.ownerId)
      .eq("status", "active"),
    input.storeSales !== undefined
      ? Promise.resolve(input.storeSales)
      : readStoreSales(admin, input.ownerId, input.now),
  ]);
  if (error) {
    console.error("[add-ons] read failed", error.message);
    return PAGE_BUSY;
  }
  if (storeSales === null && input.unreadableSales === "busy") return PAGE_BUSY;

  const rows = new Map(((data ?? []) as PublicProductRow[]).map((row) => [row.id, row]));
  const host = { isDigital: input.isDigital, currency: input.currency };
  const offered = ids.flatMap((id) => {
    const row = rows.get(id);
    if (!row) return [];
    const facts = {
      // Only active rows were read.
      status: "active" as const,
      isDigital: row.digital_file_key !== null,
      currency: toCurrency(row.currency),
      soldOut: toPublicStockBadge(row)?.state === "sold_out",
      takenDown: !isContentVisible(row.moderation_status),
    };
    if (addOnHiddenReason(facts, host) !== null) return [];
    return [{ row, sales: storeSales ? salesCovering(storeSales, row.id) : [] }];
  });
  if (offered.length === 0) return [];

  const [pricing, ratings] = await Promise.all([
    loadProductSales(admin, {
      ownerId: input.ownerId,
      products: offered.map(({ row, sales }) => ({
        productId: row.id,
        regularPriceCents: row.price_cents,
        currency: input.currency,
        sales,
        listedAt: row.created_at ?? null,
      })),
    }),
    // The add-ons' reviews in two numbers each (see readRatingSummaries).
    input.withRatings
      ? readRatingSummaries(admin, offered.map(({ row }) => row.id), "add-ons")
      : new Map<string, ProductRating>(),
  ]);

  return Promise.all(
    offered.map(async ({ row, sales }) => {
      const pagePath =
        input.pages && input.pages.linked(row.id)
          ? productPagePath(input.pages.storefrontId, row.id)
          : null;
      const card = await buildLeanAddOnCard(
        row,
        pricing.get(row.id),
        pagePath,
        ratings.get(row.id) ?? null,
        input.lean,
      );
      return { card, row, sales };
    }),
  );
}

/** Just the cards, for a page. "Not right now" offers nothing rather than
 *  failing the page around it: the main product is still for sale. */
export async function loadAddOnCards(
  admin: Admin,
  input: Parameters<typeof loadAddOns>[1],
): Promise<AddOnCard[]> {
  const lines = await loadAddOns(admin, input);
  return lines === PAGE_BUSY ? [] : lines.map((line) => line.card);
}
