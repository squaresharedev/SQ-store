// SERVER ONLY. THE QUOTE: the one place that decides what an order costs.
//
// Everything a buyer's browser sends is a REQUEST: which product, which
// version, how many, where to. None of it is a price. This function re-reads
// every fact that sets the price from the database and either answers with
// the exact amount to charge or refuses with a reason the checkout can put in
// a sentence. It never adjusts a request to make it fit: an order silently
// lowered from four to three, or a version quietly swapped for the one in
// stock, is a dispute waiting to happen.
//
// A payment provider is handed the total that comes back from here and
// nothing else. The test provider records it; Stripe (when it lands) will
// create its checkout session from it. A charge built from anything the
// request carried would be a checkout with a price field in it.
//
// THE GATE IS THE PRODUCT PAGE'S. loadPurchasable decides whether this product
// is for sale from this storefront at all (placed, active, not taken down,
// seller identity disclosed), so a product the page would 404 is one nobody
// can be charged for either.

import { createAdminClient } from "@/lib/supabase/admin";
import { loadPurchasable, type GateBudget, type Purchasable } from "@/lib/products/purchasable";
import { resolveOrderQuantity } from "@/lib/products/order-quantity";
import { parseOptionGroups } from "@/lib/products/detail";
import { optionSummaryRows } from "@/lib/products/option-details";
import { quoteShipping } from "@/lib/shipping/rates";
import { strictSelection, type Selection } from "@/lib/checkout/selection";
import type { Currency } from "@/types/product";

export type QuoteRequest = {
  storefrontId: string;
  productId: string;
  /** The version, as the option ids the buyer chose (one per group). */
  optionIds: readonly string[];
  /** How many. `unknown` because it arrives from a request body. */
  quantity: unknown;
  /** ISO 3166-1 alpha-2 delivery country. Ignored for a download. */
  country: string | null;
};

export type CheckoutQuote = {
  /** Behind the gate, for the caller that records the order. Never sent to a
   *  browser: it carries the owner id and the raw row. */
  gate: Purchasable;
  productId: string;
  title: string;
  currency: Currency;
  unitPriceCents: number;
  quantity: number;
  /** The version, in the seller's words, for the order and the receipt. */
  selection: { label: string; value: string }[];
  isDigital: boolean;
  subtotalCents: number;
  /** Null for a download; 0 when delivery is free. */
  shippingCents: number | null;
  /** The whole amount to charge, delivery included. */
  totalCents: number;
};

export type QuoteRefusal =
  /** Not for sale here (any gate failure, including the rate limit). One
   *  reason on purpose, as on the product page: nothing here is enumerable. */
  | "not_found"
  /** The storefront tile, or the stock, says there is none to sell. */
  | "sold_out"
  /** The version is missing, ambiguous, unknown or unavailable. */
  | "options"
  /** Not a whole number in range, or above this product's own limit. */
  | "quantity"
  /** Fewer in stock than asked for. */
  | "insufficient_stock"
  /** The seller does not deliver to that country (or no country given). */
  | "not_shipped_here"
  /** The seller has not priced delivery in this product's currency. */
  | "no_shipping_rates";

export type QuoteResult = { ok: true; quote: CheckoutQuote } | { ok: false; reason: QuoteRefusal };

/**
 * Price one order, or refuse it. `limit` is the rate-limit bucket the caller
 * spends on the gate (placing an order spends the tighter checkoutPlace one).
 */
export async function quoteCheckout(request: QuoteRequest, limit: GateBudget): Promise<QuoteResult> {
  const gate = await loadPurchasable(request.storefrontId, request.productId, limit);
  if (!gate) return { ok: false, reason: "not_found" };
  return quoteFromGate(gate, request, createAdminClient());
}

/**
 * The quote for a gate already passed. Split out so a caller holding the gate
 * (and a test) does not spend a second rate-limit token on the same request.
 */
export async function quoteFromGate(
  gate: Purchasable,
  request: Pick<QuoteRequest, "optionIds" | "quantity" | "country">,
  admin: ReturnType<typeof createAdminClient>,
): Promise<QuoteResult> {
  // The tile's manual flag is a seller saying "not selling this here right
  // now", which resolveOrderQuantity cannot see: it reads the product, not the
  // storefront.
  if (gate.block.soldOut) return { ok: false, reason: "sold_out" };

  const groups = parseOptionGroups(gate.row.option_groups);
  const selection: Selection | null = strictSelection(groups, request.optionIds);
  if (!selection) return { ok: false, reason: "options" };

  const line = await resolveOrderQuantity(admin, gate.row.id, request.quantity);
  if (!line.ok) {
    switch (line.reason) {
      case "unavailable":
        return { ok: false, reason: "not_found" };
      case "insufficient_stock":
        // Nothing left at all reads as sold out; some left reads as "fewer".
        return {
          ok: false,
          reason: gate.row.track_stock && (gate.row.stock_quantity ?? 0) <= 0 ? "sold_out" : "insufficient_stock",
        };
      case "invalid_request":
      case "over_limit":
        return { ok: false, reason: "quantity" };
    }
  }

  const isDigital = gate.row.digital_file_key !== null;
  let shippingCents: number | null = null;
  if (!isDigital) {
    const shipping = quoteShipping(gate.shippingPolicy, {
      profileId: gate.row.shipping_profile_id,
      country: request.country ?? "",
      subtotalCents: line.totalCents,
      currency: line.currency,
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
      gate,
      productId: gate.row.id,
      title: gate.row.title,
      currency: line.currency,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      selection: optionSummaryRows(groups, selection),
      isDigital,
      subtotalCents: line.totalCents,
      shippingCents,
      totalCents: line.totalCents + (shippingCents ?? 0),
    },
  };
}
