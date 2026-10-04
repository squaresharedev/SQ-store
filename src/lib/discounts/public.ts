// SERVER ONLY. The discount reads behind the buyer-facing pages: which sale a
// product is on, what it may announce, and whether a typed code is good.
//
// SECURITY MODEL, the gate's (lib/products/purchasable.ts): service-role reads
// behind an application gate, never an anon RLS policy. `discounts` has no
// policy a buyer's request could use, so a store's codes cannot be listed by
// anyone. Every read here names the owner AND checks the product explicitly,
// and nothing returned carries an id to a browser: ids go to the order writer
// only, through the quote.

import type { createAdminClient } from "@/lib/supabase/admin";
import { bestSale } from "@/lib/discounts/pricing";
import { priorPriceCents, saleAnnouncement, PRIOR_PRICE_WINDOW_DAYS } from "@/lib/discounts/prior-price";
import {
  DISCOUNT_COLUMNS,
  appliesInCurrency,
  coversProduct,
  discountValueOf,
  type DiscountRow,
} from "@/lib/discounts/row";
import { LIVE_DISCOUNTS_MAX, type ActiveSale, type ResolvedCode } from "@/types/discount";
import type { Currency, ProductSale } from "@/types/product";

type Admin = ReturnType<typeof createAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Price changes read back for one sale's window. A product repriced more
 *  often than this in a month gets no "was" price, which is the safe answer. */
const HISTORY_ROWS_MAX = 100;

/** A PostgREST filter value, quoted so a timestamp's dots and colons stay data. */
function quoted(value: string): string {
  return `"${value}"`;
}

/**
 * The store's sales running at `now` that cover this product. A failed read is
 * "no sale": the page and the quote read the same gate, so the price a buyer
 * sees and the price they pay still agree.
 *
 * Read in parallel with the product itself, so the product's currency is not
 * known yet: an amount off in another currency is left in, and the pricing
 * (lib/discounts/pricing.ts) gives it no effect.
 */
export async function readActiveSales(
  admin: Admin,
  ownerId: string,
  productId: string,
  now: Date,
): Promise<ActiveSale[]> {
  const at = now.toISOString();
  const { data, error } = await admin
    .from("discounts")
    .select(DISCOUNT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("kind", "automatic")
    .is("archived_at", null)
    .lte("starts_at", at)
    .or(`ends_at.is.null,ends_at.gt.${quoted(at)}`)
    .limit(LIVE_DISCOUNTS_MAX);
  if (error) {
    console.error("[discounts] sales read failed", error.message);
    return [];
  }
  const sales: ActiveSale[] = [];
  for (const row of (data ?? []) as DiscountRow[]) {
    const value = discountValueOf(row);
    if (!value || !coversProduct(row, productId)) continue;
    sales.push({ id: row.id, value, startsAt: row.starts_at, endsAt: row.ends_at });
  }
  return sales;
}

/**
 * The sale a product page (or checkout page) shows: the price it sets and what
 * it may announce. Null without a sale that lowers the price.
 *
 * The announcement needs history (the 30 days before the sale), so it is read
 * only here, for the pages that print it; the quote never needs it.
 */
export async function loadProductSale(
  admin: Admin,
  input: {
    ownerId: string;
    productId: string;
    regularPriceCents: number;
    currency: Currency;
    sales: readonly ActiveSale[];
  },
): Promise<{ priceCents: number; sale: ProductSale | null }> {
  const best = bestSale(input.sales, input.regularPriceCents, input.currency);
  if (!best) return { priceCents: input.regularPriceCents, sale: null };

  const { sale, unitPriceCents } = best;
  const windowStart = new Date(Date.parse(sale.startsAt) - PRIOR_PRICE_WINDOW_DAYS * DAY_MS).toISOString();
  const [history, others] = await Promise.all([
    admin
      .from("product_price_history")
      .select("price_cents, currency, valid_from")
      .eq("product_id", input.productId)
      .lt("valid_from", sale.startsAt)
      .order("valid_from", { ascending: false })
      .limit(HISTORY_ROWS_MAX),
    admin
      .from("discounts")
      .select(DISCOUNT_COLUMNS)
      .eq("owner_id", input.ownerId)
      .eq("kind", "automatic")
      .neq("id", sale.id)
      .lt("starts_at", sale.startsAt)
      .or(`ends_at.is.null,ends_at.gt.${quoted(windowStart)}`)
      .limit(LIVE_DISCOUNTS_MAX * 2),
  ]);

  let prior: number | null = null;
  if (history.error || others.error) {
    console.error("[discounts] sale history read failed", history.error?.message ?? others.error?.message);
  } else {
    prior = priorPriceCents({
      history: history.data.map((point) => ({
        priceCents: point.price_cents,
        currency: point.currency,
        validFrom: point.valid_from,
      })),
      otherSales: (others.data as DiscountRow[]).flatMap((row) => {
        const value = discountValueOf(row);
        // A sale stopped before it started never ran, so it never set a price.
        const neverRan = row.archived_at !== null && Date.parse(row.archived_at) <= Date.parse(row.starts_at);
        return value && !neverRan && coversProduct(row, input.productId)
          ? [{ value, startsAt: row.starts_at, endsAt: row.ends_at }]
          : [];
      }),
      saleStart: sale.startsAt,
      currency: input.currency,
    });
  }

  return {
    priceCents: unitPriceCents,
    sale: {
      regularPriceCents: input.regularPriceCents,
      ...saleAnnouncement(prior, unitPriceCents),
      endsAt: sale.endsAt,
    },
  };
}

/**
 * A code a buyer typed, if it is good for this product right now: live,
 * switched on, inside its dates, covering the product, in a currency that fits,
 * and under its usage limit. Null for every other answer, so the caller cannot
 * tell "no such code" from "expired" (and neither can whoever is guessing).
 *
 * The usage limit is counted from orders. Two buyers paying for the last use
 * at the same moment can both get it: an order is recorded after the payment,
 * when refusing it would mean refunding someone who did nothing wrong.
 */
export async function findCodeFor(
  admin: Admin,
  input: { ownerId: string; productId: string; currency: Currency; code: string; now: Date },
): Promise<ResolvedCode | null> {
  const { data, error } = await admin
    .from("discounts")
    .select(DISCOUNT_COLUMNS)
    .eq("owner_id", input.ownerId)
    .eq("kind", "code")
    .eq("code", input.code)
    .is("archived_at", null)
    .maybeSingle();
  if (error) {
    console.error("[discounts] code read failed", error.message);
    return null;
  }
  const row = data as DiscountRow | null;
  if (!row || !row.enabled || !row.code) return null;

  const at = input.now.getTime();
  if (Date.parse(row.starts_at) > at) return null;
  if (row.ends_at !== null && Date.parse(row.ends_at) <= at) return null;
  if (!coversProduct(row, input.productId)) return null;
  const value = discountValueOf(row);
  if (!value || !appliesInCurrency(value, input.currency)) return null;

  if (row.usage_limit !== null) {
    const { count, error: countError } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", input.ownerId)
      .eq("discount_code_id", row.id);
    // An uncountable limit is a limit we cannot honour: refuse the code.
    if (countError || count === null || count >= row.usage_limit) return null;
  }

  return { id: row.id, code: row.code, value };
}
