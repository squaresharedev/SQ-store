// SERVER ONLY. The discount reads behind the buyer-facing pages: which sale a
// product is on, what it may announce, and whether a typed code is good.
//
// SECURITY MODEL, the gate's (lib/products/purchasable.ts): service-role reads
// behind an application gate, never an anon RLS policy. `discounts` has no
// policy a buyer's request could use, so a store's codes cannot be listed by
// anyone. Every read here names the owner AND checks the product explicitly,
// and nothing returned carries an id to a browser: ids go to the order writer
// only, through the quote.
//
// ONE PRICE, EVERYWHERE. A storefront's tiles, a product page, the checkout
// and the quote all get a product's price from the two functions below:
// readStoreSales says which sales are running, loadProductSales turns them into
// a price and what may be announced about it. A surface that priced a product
// any other way could show a buyer one number and charge another.
//
// TWO KINDS OF READ, TWO WAYS TO FAIL:
//   - WHICH SALES ARE RUNNING sets the price. If that cannot be read, there is
//     no price: readStoreSales answers null and every caller says "not right
//     now" (lib/public/busy.ts). A page that quietly fell back to the regular
//     price would charge a buyer more than the seller is advertising.
//   - WHAT A SALE MAY SAY ABOUT ITSELF (its percentage, and the lowest price
//     of the 30 days before it) needs history. If that cannot be read, or
//     cannot be read WHOLE, the percentage is left out and the struck price is
//     called the regular price: nothing is claimed that was not checked, and
//     the amount is still right.

import type { createAdminClient } from "@/lib/supabase/admin";
import { bestSale, offerPercentOff } from "@/lib/discounts/pricing";
import {
  priorPriceCents,
  saleAnnouncement,
  PRIOR_PRICE_WINDOW_DAYS,
  type PricePoint,
} from "@/lib/discounts/prior-price";
import {
  DISCOUNT_COLUMNS,
  appliesInCurrency,
  coversProduct,
  discountValueOf,
  type DiscountRow,
} from "@/lib/discounts/row";
import {
  DISCOUNT_SCOPES,
  type ActiveSale,
  type ResolvedCode,
  type StoreSale,
} from "@/types/discount";
import type { Currency, ProductSale } from "@/types/product";

type Admin = ReturnType<typeof createAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Price changes kept for one sale's window, newest first. A product repriced
 *  more often than this in a month gets no "was" price, which is the safe
 *  answer. */
const HISTORY_ROWS_MAX = 100;
/** Products asked about in one history read, so the request's address stays
 *  well inside what a proxy will carry (a uuid is 36 characters). */
const HISTORY_PRODUCTS_PER_READ = 100;
/** The most single-product history reads one request falls back to when a
 *  shared read came back short. Past it a product simply announces nothing. */
const HISTORY_FALLBACK_READS_MAX = 20;
/** Rows one list read asks for: PostgREST's own default ceiling. Every list
 *  read here also asks for the exact count, so "fewer came back than exist" is
 *  seen and handled, never mistaken for the whole answer. */
const READ_ROWS_MAX = 1000;
/** Tries at the one read that sets a price. A blip on a hot path should not
 *  cost a buyer the page; a second failure is a real one. */
const SALES_READ_ATTEMPTS = 2;

/** A PostgREST filter value, quoted so a timestamp's dots and colons stay data. */
function quoted(value: string): string {
  return `"${value}"`;
}

/** Whether a list read returned every row that matched. */
function isWhole(returned: number, count: number | null | undefined): boolean {
  // No count to go by: whole only if the read stopped short of its ceiling.
  return count == null ? returned < READ_ROWS_MAX : count <= returned;
}

/** `items` in runs of at most `size`. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * The store's sales running at `now`, or NULL when they could not be read.
 *
 * Null is "we do not know what anything costs right now", and a caller must
 * treat it as "not right now", never as "no sale": see the header.
 *
 * The order is fixed (oldest first), so when two sales make a product equally
 * cheap every surface credits the same one.
 */
export async function readStoreSales(admin: Admin, ownerId: string, now: Date): Promise<StoreSale[] | null> {
  const at = now.toISOString();
  const instant = now.getTime();
  for (let attempt = 1; attempt <= SALES_READ_ATTEMPTS; attempt++) {
    try {
      const { data, error, count } = await admin
        .from("discounts")
        .select(DISCOUNT_COLUMNS, { count: "exact" })
        .eq("owner_id", ownerId)
        .eq("kind", "automatic")
        .is("archived_at", null)
        .lte("starts_at", at)
        .or(`ends_at.is.null,ends_at.gt.${quoted(at)}`)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(READ_ROWS_MAX);
      if (error) {
        console.error("[discounts] sales read failed", error.message);
        continue;
      }
      const rows = (data ?? []) as DiscountRow[];
      if (!isWhole(rows.length, count)) {
        // More running sales than one read returns: an answer with some of
        // them missing would price some products too high.
        console.error("[discounts] sales read came back short", rows.length, count);
        return null;
      }
      const sales: StoreSale[] = [];
      for (const row of rows) {
        const value = discountValueOf(row);
        const appliesTo = DISCOUNT_SCOPES.find((scope) => scope === row.applies_to);
        // The same window the query asked for, checked again on what came
        // back: a sale is running from its start up to, not including, its end.
        const running =
          Date.parse(row.starts_at) <= instant && (row.ends_at === null || Date.parse(row.ends_at) > instant);
        if (!value || !appliesTo || !running || row.archived_at !== null) continue;
        sales.push({
          id: row.id,
          value,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          appliesTo,
          productIds: appliesTo === "products" ? (row.product_ids ?? []) : [],
        });
      }
      return sales;
    } catch (error) {
      console.error("[discounts] sales read threw", error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

/** The sales among `sales` that cover one product, in the same order. */
export function salesCovering(sales: readonly StoreSale[], productId: string): ActiveSale[] {
  return sales
    .filter((sale) => sale.appliesTo === "all" || sale.productIds.includes(productId))
    .map(({ id, value, startsAt, endsAt }) => ({ id, value, startsAt, endsAt }));
}

/**
 * The store's sales running at `now` that cover this product, or NULL when
 * they could not be read (see readStoreSales).
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
): Promise<ActiveSale[] | null> {
  const sales = await readStoreSales(admin, ownerId, now);
  return sales && salesCovering(sales, productId);
}

/** One product to price: what it is listed at, and the running sales that
 *  cover it (salesCovering, or the gate's own `sales`). */
export type PricedProduct = {
  productId: string;
  regularPriceCents: number;
  currency: Currency;
  sales: readonly ActiveSale[];
  /** When the product was listed (products.created_at), for a product younger
   *  than the 30 days a sale is measured against. Null when not known. */
  listedAt: string | null;
};

/** What one costs right now, and the sale behind it (null without one). */
export type ProductPricing = { priceCents: number; sale: ProductSale | null };

type HistoryRow = { product_id: string; price_cents: number; currency: string; valid_from: string };

/** A product a sale lowers: the sale that makes it cheapest, and that price. */
type OnSale = { product: PricedProduct; sale: ActiveSale; unitPriceCents: number; saleStart: number };

/**
 * The price history of some products, each from before its own sale began,
 * newest first, by product id. A product is ABSENT from the answer when its
 * history could not be read whole, which its caller reads as "nothing to
 * announce".
 *
 * `budget` is the single-product reads left to fall back on (shared across
 * the request).
 */
async function readPriceHistory(
  admin: Admin,
  wanted: readonly OnSale[],
  budget: { reads: number },
): Promise<Map<string, HistoryRow[]>> {
  const known = new Map<string, HistoryRow[]>();
  // One read up to the LATEST start among them; each product then keeps only
  // what falls before its own.
  const latest = wanted.reduce((a, b) => (b.saleStart > a.saleStart ? b : a));
  const { data, error, count } = await admin
    .from("product_price_history")
    .select("product_id, price_cents, currency, valid_from", { count: "exact" })
    .in("product_id", [...new Set(wanted.map((item) => item.product.productId))])
    .lt("valid_from", latest.sale.startsAt)
    .order("valid_from", { ascending: false })
    .limit(READ_ROWS_MAX);
  if (error) {
    console.error("[discounts] price history read failed", error.message);
    return known;
  }
  const rows = (data ?? []) as HistoryRow[];
  const whole = isWhole(rows.length, count);
  // Short, but for ONE product the newest rows are all its window keeps anyway.
  if (whole || (wanted.length === 1 && rows.length >= HISTORY_ROWS_MAX)) {
    for (const { product, saleStart } of wanted) {
      known.set(
        product.productId,
        rows
          .filter((row) => row.product_id === product.productId && Date.parse(row.valid_from) < saleStart)
          .slice(0, HISTORY_ROWS_MAX),
      );
    }
    return known;
  }
  if (wanted.length === 1) return known;
  // Short for several: the rows cut off are the OLDEST, exactly the ones that
  // prove a price 30 days back. Ask again one product at a time, as far as the
  // budget goes.
  const retried = wanted.slice(0, Math.max(0, budget.reads));
  budget.reads -= retried.length;
  const answers = await Promise.all(retried.map((item) => readPriceHistory(admin, [item], budget)));
  for (const answer of answers) for (const [productId, history] of answer) known.set(productId, history);
  return known;
}

/**
 * Every other sale of the store that could have set a price in the 30 days
 * before one of these sales began, archived ones included (an earlier sale
 * lowers the price a later one may be compared against). NULL when they could
 * not be read whole: a missing earlier sale would make a "was" price too high.
 */
async function readEarlierSales(
  admin: Admin,
  ownerId: string,
  before: string,
  runningAfter: string,
): Promise<DiscountRow[] | null> {
  const { data, error, count } = await admin
    .from("discounts")
    .select(DISCOUNT_COLUMNS, { count: "exact" })
    .eq("owner_id", ownerId)
    .eq("kind", "automatic")
    .lt("starts_at", before)
    .or(`ends_at.is.null,ends_at.gt.${quoted(runningAfter)}`)
    .order("starts_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(READ_ROWS_MAX);
  if (error) {
    console.error("[discounts] earlier sales read failed", error.message);
    return null;
  }
  const rows = (data ?? []) as DiscountRow[];
  if (!isWhole(rows.length, count)) {
    console.error("[discounts] earlier sales read came back short", rows.length, count);
    return null;
  }
  return rows;
}

/**
 * The lowest price each product had in the 30 days before its sale began, by
 * product id: what its sale's percentage is measured against. A product is
 * absent when the records do not prove one. Never throws.
 */
async function readPriorPrices(admin: Admin, ownerId: string, onSale: readonly OnSale[]): Promise<Map<string, number>> {
  const prior = new Map<string, number>();
  const dated = onSale.filter((item) => !Number.isNaN(item.saleStart));
  if (dated.length === 0) return prior;
  try {
    // One read of the store's other sales for the whole board: the latest
    // start bounds it above, the earliest window start below, and each product
    // then keeps only what falls before ITS sale.
    const latest = dated.reduce((a, b) => (b.saleStart > a.saleStart ? b : a));
    const earliestStart = Math.min(...dated.map((item) => item.saleStart));
    const windowStart = new Date(earliestStart - PRIOR_PRICE_WINDOW_DAYS * DAY_MS).toISOString();
    const budget = { reads: HISTORY_FALLBACK_READS_MAX };

    const [histories, earlier] = await Promise.all([
      Promise.all(
        chunked(dated, HISTORY_PRODUCTS_PER_READ).map((chunk) => readPriceHistory(admin, chunk, budget)),
      ),
      readEarlierSales(admin, ownerId, latest.sale.startsAt, windowStart),
    ]);
    if (earlier === null) return prior;
    const history = new Map(histories.flatMap((answer) => [...answer]));

    for (const { product, sale, saleStart } of dated) {
      const rows = history.get(product.productId);
      if (!rows) continue;
      const from = saleStart - PRIOR_PRICE_WINDOW_DAYS * DAY_MS;
      const points: PricePoint[] = rows.map((row) => ({
        priceCents: row.price_cents,
        currency: row.currency,
        validFrom: row.valid_from,
      }));
      const otherSales = earlier.flatMap((row) => {
        if (row.id === sale.id || !(Date.parse(row.starts_at) < saleStart)) return [];
        if (row.ends_at !== null && !(Date.parse(row.ends_at) > from)) return [];
        // A sale stopped before it started never ran, so it never set a price.
        const neverRan = row.archived_at !== null && Date.parse(row.archived_at) <= Date.parse(row.starts_at);
        const value = discountValueOf(row);
        return value && !neverRan && coversProduct(row, product.productId)
          ? [{ value, startsAt: row.starts_at, endsAt: row.ends_at }]
          : [];
      });
      const cents = priorPriceCents({
        history: points,
        otherSales,
        saleStart: sale.startsAt,
        currency: product.currency,
        listedAt: product.listedAt,
      });
      if (cents !== null) prior.set(product.productId, cents);
    }
  } catch (error) {
    console.error("[discounts] sale history read threw", error instanceof Error ? error.message : String(error));
    prior.clear();
  }
  return prior;
}

/**
 * WHAT EACH PRODUCT COSTS RIGHT NOW, and what its sale may announce, by product
 * id. Every product given gets an answer.
 *
 * The one place a buyer-facing price is worked out from a store's sales: a
 * storefront's tiles ask for the whole board at once, a product page and the
 * checkout ask for one product (loadProductSale), and because it is the same
 * function they cannot disagree. The quote prices from the same sales with the
 * same `bestSale`.
 *
 * The announcement needs history (the 30 days before the sale), read only
 * here, for the surfaces that print it; the quote never needs it.
 */
export async function loadProductSales(
  admin: Admin,
  input: { ownerId: string; products: readonly PricedProduct[] },
): Promise<Map<string, ProductPricing>> {
  const pricing = new Map<string, ProductPricing>();
  const onSale: OnSale[] = [];
  for (const product of input.products) {
    const best = bestSale(product.sales, product.regularPriceCents, product.currency);
    if (best) onSale.push({ product, ...best, saleStart: Date.parse(best.sale.startsAt) });
    else pricing.set(product.productId, { priceCents: product.regularPriceCents, sale: null });
  }
  if (onSale.length === 0) return pricing;

  const prior = await readPriorPrices(admin, input.ownerId, onSale);
  for (const { product, sale, unitPriceCents } of onSale) {
    pricing.set(product.productId, {
      priceCents: unitPriceCents,
      sale: {
        regularPriceCents: product.regularPriceCents,
        ...saleAnnouncement(prior.get(product.productId) ?? null, unitPriceCents),
        offerPercent: offerPercentOff(sale.value, product.regularPriceCents, product.currency),
        endsAt: sale.endsAt,
      },
    });
  }
  return pricing;
}

/**
 * The sale a product page (or checkout page) shows: the price it sets and what
 * it may announce. `sale` is null without a sale that lowers the price.
 * loadProductSales, asked about one product.
 */
export async function loadProductSale(
  admin: Admin,
  input: {
    ownerId: string;
    productId: string;
    regularPriceCents: number;
    currency: Currency;
    sales: readonly ActiveSale[];
    listedAt: string | null;
  },
): Promise<ProductPricing> {
  const { ownerId, ...product } = input;
  const pricing = await loadProductSales(admin, { ownerId, products: [product] });
  return pricing.get(input.productId) ?? { priceCents: input.regularPriceCents, sale: null };
}

/**
 * How long, from `now`, until the first of these sale prices stops being true:
 * the milliseconds to the earliest end among the sales behind them, or null
 * when none of them has an end. For a page that should read its prices again
 * at that moment rather than keep showing a price that has ended
 * (components/product-page/PriceRefresh).
 *
 * A length of time, not a moment: the page counts it down on the buyer's own
 * clock, so a clock that is wrong by an hour changes nothing.
 */
export function msUntilSaleEnds(pricing: Iterable<ProductPricing>, now: Date): number | null {
  let earliest: number | null = null;
  for (const { sale } of pricing) {
    const end = sale?.endsAt ? Date.parse(sale.endsAt) : Number.NaN;
    if (!Number.isNaN(end) && (earliest === null || end < earliest)) earliest = end;
  }
  return earliest === null ? null : Math.max(0, earliest - now.getTime());
}

/**
 * A code a buyer typed, if it is good for this product right now: live,
 * switched on, inside its dates, covering the product, in a currency that fits,
 * and under its usage limit. Null for every other answer, so the caller cannot
 * tell "no such code" from "expired" (and neither can whoever is guessing).
 *
 * The usage limit is counted from orders that still stand: one that was taken
 * back (refunded) gives its use back, and one still waiting on its payment
 * holds it (the same rule as discount_performance.uses, 20261008). This read is
 * the quote's answer, not the guarantee: order_place re-counts under a row lock
 * when the order is written (20261022), so two buyers reaching for the last use
 * cannot both be charged for it.
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
      .eq("discount_code_id", row.id)
      .neq("status", "refunded");
    // An uncountable limit is a limit we cannot honour: refuse the code.
    if (countError || count === null || count >= row.usage_limit) return null;
  }

  return { id: row.id, code: row.code, value };
}
