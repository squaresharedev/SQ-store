// SERVER ONLY. THE QUOTE: the one place that decides what an order costs.
//
// Everything a buyer's browser sends is a REQUEST: which products, which
// versions, how many, where to. None of it is a price. This module re-reads
// every fact that sets the price from the database and either answers with
// the exact amount to charge or refuses with a reason the checkout can put in
// a sentence. It never adjusts a request to make it fit: an order silently
// lowered from four to three, or a version quietly swapped for the one in
// stock, is a dispute waiting to happen.
//
// A payment provider is handed the total that comes back from here and
// nothing else. A charge built from anything the request carried would be a
// checkout with a price field in it.
//
// ONE ORDER, ANY NUMBER OF LINES. "Buy now" is an order of one line (plus any
// "Add to your order" lines); a cart is an order of up to CART_LINES_MAX.
// Both are priced here, by the same rules, so there is one price authority.
//
// THE GATE IS THE PRODUCT PAGE'S. gatePurchasableLines decides whether each
// product is for sale from this storefront at all (placed, active, not taken
// down, seller identity disclosed), so a product the page would 404 is one
// nobody can be charged for either. It reads every line's product in one go;
// nothing below reads the database again.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  gatePurchasableLines,
  type GateBudget,
  type PurchasableItem,
  type PurchasableLines,
  type PurchasableStore,
} from "@/lib/products/purchasable";
import { checkOrderQuantity } from "@/lib/products/order-quantity";
import { parseOptionGroups } from "@/lib/products/detail";
import { optionSummaryRows } from "@/lib/products/option-details";
import { canQuoteShipping, quoteOrderShipping } from "@/lib/shipping/rates";
import { strictSelection } from "@/lib/checkout/selection";
import { bestSale, priceLines } from "@/lib/discounts/pricing";
import { findCodeForLines, type ResolvedLinesCode } from "@/lib/discounts/public";
import { toCurrency } from "@/lib/format/money";
import { PAGE_BUSY } from "@/lib/public/busy";
import { purchaseLinkTarget } from "@/components/product-page/cta-target";
import { CART_LINES_MAX } from "@/lib/cart/limits";
import type { OrderLineSource } from "@/lib/checkout/lines";
import type { LineProblem } from "@/lib/checkout/line-problem";
import type { AddOnPick } from "@/lib/storefront/product-page-url";
import type { Currency } from "@/types/product";
import type { PaidLine } from "@/lib/orders/record";

/** One line as the quote is asked for it. `quantity` is `unknown` because it
 *  arrives from a request body. */
export type QuoteLineInput = {
  productId: string;
  /** The version, as the option ids the buyer chose (one per group). */
  optionIds: readonly string[];
  quantity: unknown;
  source?: OrderLineSource;
};

export type QuoteRequest = {
  storefrontId: string;
  /** The order's lines, in order. The first is the order's own row. */
  lines: readonly QuoteLineInput[];
  /** ISO 3166-1 alpha-2 delivery country. Ignored when nothing ships. */
  country: string | null;
  /** A discount code the buyer typed, already normalised (validation/checkout).
   *  A code is a REQUEST like the rest: it is looked up here, and a code that
   *  does not apply refuses the quote rather than being quietly dropped. */
  discountCode?: string | null;
};

export type { LineProblem };

export type QuoteRefusal =
  | LineProblem
  /** The seller does not deliver to that country (or no country given). */
  | "not_shipped_here"
  /** A discount code was given that does not apply to this order (unknown,
   *  ended, used up, or for none of these products). One reason for all. */
  | "discount_invalid";

export type QuoteResult =
  | { ok: true; quote: CheckoutQuote }
  /** `line`: which line (by index) refused the order, when one did. */
  | { ok: false; reason: QuoteRefusal; line?: number };

/** One line, as priced. */
export type QuotedLine = {
  productId: string;
  source: OrderLineSource;
  title: string;
  /** The REGULAR price of one: what the line snapshots as product_price_cents. */
  regularUnitCents: number;
  /** One item's price before any code: its sale's when a sale priced it. */
  unitPriceCents: number;
  quantity: number;
  /** unitPriceCents x quantity. */
  subtotalCents: number;
  /** What the line is charged, after its share of any code. */
  amountCents: number;
  /** The discount that set this line's price (a sale, or the code), and how
   *  much less than the regular price it costs. Null without one. */
  discount: { id: string; cents: number } | null;
  /** The version, in the seller's words, for the order and the receipt. */
  selection: { label: string; value: string }[];
  /** The same version as option ids, in group order: what identifies it
   *  whatever the seller later renames (the order's lines digest). */
  optionIds: string[];
  isDigital: boolean;
  shippingProfileId: string | null;
};

export type CheckoutQuote = {
  /** Behind the gate, for the caller that records the order. Never sent to a
   *  browser: it carries the owner id and the raw rows. */
  store: PurchasableStore;
  /** The lines, in the order asked. The first is the order's own row. */
  lines: QuotedLine[];
  currency: Currency;
  /** Something in the order is posted: it needs an address and delivery. */
  ships: boolean;
  /** Something in the order is a download: it needs the buyer's consent to
   *  immediate supply (CRD art. 16(m)). */
  hasDownloads: boolean;
  /** The items before any code. */
  subtotalCents: number;
  /** What the code took off the order (0 unless it won). */
  codeCents: number;
  /** What the items cost after every discount. */
  itemsCents: number;
  /** The valid code the buyer entered, credited to its channel even when the
   *  sales did better. */
  credit: { id: string; code: string } | null;
  /** Null when nothing ships; 0 when delivery is free. */
  shippingCents: number | null;
  /** The whole amount to charge, delivery included. */
  totalCents: number;
};

/** The quote's lines after the first, as the order writer (lib/orders/record.ts)
 *  takes them. One mapping for every payment provider. */
export function paidLines(quote: CheckoutQuote): PaidLine[] {
  return quote.lines.slice(1).map((line) => ({
    productId: line.productId,
    source: line.source,
    selection: line.selection,
    unitPriceCents: line.regularUnitCents,
    quantity: line.quantity,
    amountCents: line.amountCents,
    discountId: line.discount?.id ?? null,
  }));
}

/**
 * Price one order, or refuse it. `limit` is the rate-limit bucket the caller
 * spends on the gate: ONE token for the whole order, however many lines.
 */
export async function quoteOrder(request: QuoteRequest, limit: GateBudget): Promise<QuoteResult> {
  if (request.lines.length === 0 || request.lines.length > CART_LINES_MAX) {
    return { ok: false, reason: "not_found" };
  }
  const gate = await gatePurchasableLines(
    request.storefrontId,
    request.lines.map((line) => line.productId),
    limit,
  );
  if (!gate || gate === PAGE_BUSY) return { ok: false, reason: "not_found" };

  let code: ResolvedLinesCode | null = null;
  if (request.discountCode) {
    // The order's currency is its first line's; a line in another currency is
    // refused below anyway.
    const first = gate.items.get(request.lines[0]!.productId);
    if (!first) return { ok: false, reason: "not_found", line: 0 };
    code = await findCodeForLines(createAdminClient(), {
      ownerId: gate.store.ownerId,
      productIds: request.lines.map((line) => line.productId).filter((id) => gate.items.has(id)),
      currency: toCurrency(first.row.currency),
      code: request.discountCode,
      now: gate.store.now,
    });
    if (!code) return { ok: false, reason: "discount_invalid" };
  }
  return quoteFromLines(gate, request, code);
}

/**
 * "Buy now": one product, its version and quantity, and whatever was taken
 * from its "Add to your order". An order of lines like any other.
 */
export function buyNowLines(input: {
  productId: string;
  optionIds: readonly string[];
  quantity: unknown;
  addOns?: readonly AddOnPick[];
}): QuoteLineInput[] {
  return [
    { productId: input.productId, optionIds: input.optionIds, quantity: input.quantity, source: "cart" },
    ...(input.addOns ?? []).map((pick) => ({
      productId: pick.productId,
      optionIds: pick.optionIds,
      quantity: 1,
      source: "add_on" as const,
    })),
  ];
}

/** One line after its checks: everything pricing needs, or its problem. */
export type AssessedLine =
  | {
      ok: true;
      productId: string;
      source: OrderLineSource;
      quantity: number;
      item: PurchasableItem;
      selection: { label: string; value: string }[];
      optionIds: string[];
      isDigital: boolean;
      currency: Currency;
    }
  | { ok: false; productId: string; problem: LineProblem };

/**
 * Check every line against the gate's rows, without refusing: each line comes
 * back with what pricing needs, or the one problem that stops it. The quote
 * refuses on the first problem; the cart shows each line's own.
 *
 * Quantities are checked over every line of a product together: two lines of
 * one product in two versions draw on ONE shelf and ONE per-order limit.
 */
export function assessLines(
  gate: Pick<PurchasableLines, "store" | "items">,
  lines: readonly QuoteLineInput[],
): AssessedLine[] {
  const first: AssessedLine[] = lines.map((line) => {
    const item = gate.items.get(line.productId);
    // Sold through the seller's own link: their page sends buyers there, so
    // nothing of ours sells it.
    if (!item || purchaseLinkTarget(item.row.purchase_url)) {
      return { ok: false, productId: line.productId, problem: "not_found" };
    }
    // The tile's manual flag is a seller saying "not selling this here right
    // now", which the stock cannot show: it is the storefront's, not the
    // product's.
    if (item.block?.soldOut) return { ok: false, productId: line.productId, problem: "sold_out" };
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, productId: line.productId, problem: "quantity" };
    }
    const groups = parseOptionGroups(item.row.option_groups);
    const chosen = strictSelection(groups, line.optionIds);
    if (!chosen) return { ok: false, productId: line.productId, problem: "options" };
    const isDigital = item.row.digital_file_key !== null;
    const currency = toCurrency(item.row.currency);
    // A parcel without a delivery price in its currency cannot show an honest
    // total (EU CRD art. 6(1)(e)).
    if (!isDigital && !canQuoteShipping(gate.store.shippingPolicy, currency)) {
      return { ok: false, productId: line.productId, problem: "no_shipping_rates" };
    }
    return {
      ok: true,
      productId: line.productId,
      source: line.source ?? "cart",
      quantity,
      item,
      selection: optionSummaryRows(groups, chosen),
      optionIds: groups.map((group) => chosen[group.id]!.id),
      isDigital,
      currency,
    };
  });

  // ONE currency per order: the first sellable line's.
  const orderCurrency = first.find((line) => line.ok)?.currency ?? null;
  const priced = first.map((line): AssessedLine =>
    line.ok && line.currency !== orderCurrency
      ? { ok: false, productId: line.productId, problem: "currency" }
      : line,
  );

  // The shelf and the per-order limit, per PRODUCT over all its lines.
  const wanted = new Map<string, number>();
  for (const line of priced) {
    if (line.ok) wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.quantity);
  }
  const verdicts = new Map<string, LineProblem | null>();
  for (const [productId, total] of wanted) {
    const row = gate.items.get(productId)!.row;
    const check = checkOrderQuantity(row, total);
    verdicts.set(
      productId,
      check.ok
        ? null
        : check.reason === "insufficient_stock"
          ? (row.stock_quantity ?? 0) <= 0
            ? "sold_out"
            : "insufficient_stock"
          : check.reason === "unavailable"
            ? "not_found"
            : "quantity",
    );
  }
  return priced.map((line) => {
    if (!line.ok) return line;
    const problem = verdicts.get(line.productId);
    return problem ? { ok: false, productId: line.productId, problem } : line;
  });
}

/** What pricing makes of the sellable lines: the priced lines, the items and
 *  delivery. Shared by the quote and the cart, so they cannot disagree. */
export type PricedOrderLines = {
  lines: QuotedLine[];
  currency: Currency;
  subtotalCents: number;
  codeCents: number;
  itemsCents: number;
  /** What the POSTED lines cost after discounts: free delivery is earned on
   *  them (a download has no parcel to make free). */
  shippedItemsCents: number;
  ships: boolean;
  hasDownloads: boolean;
};

/** Price lines that passed assessLines (all of them sellable, one currency). */
export function priceAssessedLines(
  sellable: readonly Extract<AssessedLine, { ok: true }>[],
  code: ResolvedLinesCode | null,
): PricedOrderLines {
  const currency = sellable[0]?.currency ?? "EUR";
  const sales = sellable.map((line) => bestSale(line.item.sales, line.item.row.price_cents, currency));
  const priced = priceLines({
    currency,
    code: code?.value ?? null,
    lines: sellable.map((line, index) => ({
      regularUnitCents: line.item.row.price_cents,
      saleUnitCents: sales[index]?.unitPriceCents ?? null,
      quantity: line.quantity,
      coveredByCode: code?.covers.includes(line.productId) ?? false,
    })),
  });
  const lines: QuotedLine[] = sellable.map((line, index) => {
    const at = priced.lines[index]!;
    const discountId = at.applied === "code" ? code?.id : at.applied === "sale" ? sales[index]?.sale.id : undefined;
    return {
      productId: line.productId,
      source: line.source,
      title: line.item.row.title,
      regularUnitCents: line.item.row.price_cents,
      unitPriceCents: at.unitPriceCents,
      quantity: line.quantity,
      subtotalCents: at.subtotalCents,
      amountCents: at.amountCents,
      discount: discountId && at.discountCents > 0 ? { id: discountId, cents: at.discountCents } : null,
      selection: line.selection,
      optionIds: line.optionIds,
      isDigital: line.isDigital,
      shippingProfileId: line.item.row.shipping_profile_id,
    };
  });
  return {
    lines,
    currency,
    subtotalCents: priced.subtotalCents,
    codeCents: priced.codeCents,
    itemsCents: priced.itemsCents,
    shippedItemsCents: lines.reduce((total, line) => total + (line.isDigital ? 0 : line.amountCents), 0),
    ships: lines.some((line) => !line.isDigital),
    hasDownloads: lines.some((line) => line.isDigital),
  };
}

/**
 * The quote for a gate already passed. Split out so a caller holding the gate
 * (and a test) does not spend a second rate-limit token on the same request.
 * `code` is a code already found valid for these products (quoteOrder looks
 * it up), so nothing here reads a discount. Pure: the gate read everything.
 */
export function quoteFromLines(
  gate: Pick<PurchasableLines, "store" | "items">,
  request: Pick<QuoteRequest, "lines" | "country">,
  code: ResolvedLinesCode | null = null,
): QuoteResult {
  const assessed = assessLines(gate, request.lines);
  const refused = assessed.findIndex((line) => !line.ok);
  if (refused !== -1) {
    const line = assessed[refused] as Extract<AssessedLine, { ok: false }>;
    return { ok: false, reason: line.problem, line: refused };
  }
  const sellable = assessed as Extract<AssessedLine, { ok: true }>[];
  const priced = priceAssessedLines(sellable, code);

  let shippingCents: number | null = null;
  if (priced.ships) {
    // ONE parcel, charged once: the highest of its products' rates.
    const shipping = quoteOrderShipping(gate.store.shippingPolicy, {
      profileIds: priced.lines.flatMap((line) => (line.isDigital ? [] : [line.shippingProfileId])),
      country: request.country ?? "",
      // After discounts: free delivery is earned on what the buyer pays.
      subtotalCents: priced.shippedItemsCents,
      currency: priced.currency,
    });
    if (!shipping.ok) {
      return {
        ok: false,
        reason: shipping.reason === "not_shipped_here" ? "not_shipped_here" : "no_shipping_rates",
      };
    }
    shippingCents = shipping.rateCents;
  }

  return {
    ok: true,
    quote: {
      store: gate.store,
      lines: priced.lines,
      currency: priced.currency,
      ships: priced.ships,
      hasDownloads: priced.hasDownloads,
      subtotalCents: priced.subtotalCents,
      codeCents: priced.codeCents,
      itemsCents: priced.itemsCents,
      credit: code ? { id: code.id, code: code.code } : null,
      shippingCents,
      totalCents: priced.itemsCents + (shippingCents ?? 0),
    },
  };
}
