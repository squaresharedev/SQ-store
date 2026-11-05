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
import { quoteOrderShipping } from "@/lib/shipping/rates";
import { strictSelection, type Selection } from "@/lib/checkout/selection";
import { bestSale } from "@/lib/discounts/pricing";
import { priceBasket, type BasketAddOn } from "@/lib/checkout/basket";
import { findCodeFor } from "@/lib/discounts/public";
import { toCurrency } from "@/lib/format/money";
import { parseAddOnIds } from "@/lib/products/detail";
import { loadAddOns } from "@/lib/products/add-ons";
import { isProductPageSectionShown } from "@/lib/storefront/product-page";
import { PAGE_BUSY } from "@/lib/public/busy";
import type { AddOnPick } from "@/lib/storefront/product-page-url";
import { ADD_ONS_MAX, type Currency } from "@/types/product";
import type { ResolvedCode } from "@/types/discount";
import type { PaidAddOn } from "@/lib/orders/record";

export type QuoteRequest = {
  storefrontId: string;
  productId: string;
  /** The version, as the option ids the buyer chose (one per group). */
  optionIds: readonly string[];
  /** How many. `unknown` because it arrives from a request body. */
  quantity: unknown;
  /** ISO 3166-1 alpha-2 delivery country. Ignored for a download. */
  country: string | null;
  /** A discount code the buyer typed, already normalised (validation/checkout).
   *  A code is a REQUEST like the rest: it is looked up here, and a code that
   *  does not apply refuses the quote rather than being quietly dropped. */
  discountCode?: string | null;
  /** "Add to your order": the other products the buyer took, each with its
   *  version. Requests too: only the main product's own add-ons are priced,
   *  and any one that cannot be sold refuses the whole quote. */
  addOns?: readonly AddOnPick[];
};

/** One "Add to your order" line, as priced. */
export type QuotedAddOn = {
  productId: string;
  title: string;
  /** The REGULAR price of one: what the line snapshots as product_price_cents. */
  regularUnitCents: number;
  /** One item's price: its sale's when a sale lowers it. */
  unitPriceCents: number;
  quantity: number;
  /** What the line is charged. */
  amountCents: number;
  /** The sale that priced it, and how much it took off (null without one). */
  discount: { id: string; cents: number } | null;
  /** The version, in the seller's words. */
  selection: { label: string; value: string }[];
};

export type CheckoutQuote = {
  /** Behind the gate, for the caller that records the order. Never sent to a
   *  browser: it carries the owner id and the raw row. */
  gate: Purchasable;
  productId: string;
  title: string;
  currency: Currency;
  /** The REGULAR price of one, what the order snapshots as
   *  product_price_cents. Discounts are measured from it. */
  regularUnitCents: number;
  /** One item's price before any code: the sale price when a sale won. */
  unitPriceCents: number;
  quantity: number;
  /** The version, in the seller's words, for the order and the receipt. */
  selection: { label: string; value: string }[];
  isDigital: boolean;
  /** unitPriceCents x quantity. */
  subtotalCents: number;
  /** What the MAIN product's items cost after every discount. */
  itemsCents: number;
  /** The add-on lines, in the seller's order (empty for most orders). */
  addOns: QuotedAddOn[];
  /** What the add-on lines cost together. itemsCents + addOnsCents is what
   *  delivery's free-over threshold is measured on. */
  addOnsCents: number;
  /** The discount that set the price, for the order (null without one).
   *  `cents` is how much less than the regular price the items cost. When it
   *  is the same discount as `credit`, the code set the price. */
  discount: { id: string; cents: number } | null;
  /** The valid code the buyer entered, credited to its channel even when a
   *  better sale set the price. */
  credit: { id: string; code: string } | null;
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
  | "no_shipping_rates"
  /** A discount code was given that does not apply to this order (unknown,
   *  ended, used up, or not for this product). One reason for all of them. */
  | "discount_invalid"
  /** An add-on the buyer took cannot be sold with this order right now (not
   *  offered with this product, gone, sold out, or that version is not). */
  | "add_on_unavailable";

export type QuoteResult = { ok: true; quote: CheckoutQuote } | { ok: false; reason: QuoteRefusal };

/** The quote's add-on lines, as the order writer (lib/orders/record.ts) takes
 *  them. One mapping for every payment provider. */
export function paidAddOns(quote: CheckoutQuote): PaidAddOn[] {
  return quote.addOns.map((line) => ({
    productId: line.productId,
    selection: line.selection,
    unitPriceCents: line.regularUnitCents,
    quantity: line.quantity,
    amountCents: line.amountCents,
    discountId: line.discount?.id ?? null,
  }));
}

/**
 * Price one order, or refuse it. `limit` is the rate-limit bucket the caller
 * spends on the gate (placing an order spends the tighter checkoutPlace one).
 */
export async function quoteCheckout(request: QuoteRequest, limit: GateBudget): Promise<QuoteResult> {
  const gate = await loadPurchasable(request.storefrontId, request.productId, limit);
  if (!gate) return { ok: false, reason: "not_found" };
  const admin = createAdminClient();
  let code: ResolvedCode | null = null;
  if (request.discountCode) {
    code = await findCodeFor(admin, {
      ownerId: gate.ownerId,
      productId: gate.row.id,
      currency: toCurrency(gate.row.currency),
      code: request.discountCode,
      now: gate.now,
    });
    if (!code) return { ok: false, reason: "discount_invalid" };
  }
  return quoteFromGate(gate, request, admin, code);
}

/**
 * The quote for a gate already passed. Split out so a caller holding the gate
 * (and a test) does not spend a second rate-limit token on the same request.
 * `code` is a code already found valid for this gate (quoteCheckout looks it
 * up), so pricing here never reads a discount itself.
 */
export async function quoteFromGate(
  gate: Purchasable,
  request: Pick<QuoteRequest, "optionIds" | "quantity" | "country" | "addOns">,
  admin: ReturnType<typeof createAdminClient>,
  code: ResolvedCode | null = null,
): Promise<QuoteResult> {
  // The tile's manual flag is a seller saying "not selling this here right
  // now", which resolveOrderQuantity cannot see: it reads the product, not the
  // storefront.
  if (gate.block?.soldOut) return { ok: false, reason: "sold_out" };

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

  // "ADD TO YOUR ORDER". Each line is re-read through the same rules the page
  // offered it under (lib/products/add-ons.ts), held to an exact version like
  // the main product, and checked against its own stock. Anything that does
  // not pass refuses the whole quote: an order quietly missing a line the
  // buyer saw in their total is the same dispute as a lowered quantity.
  const picks = request.addOns ?? [];
  const extras: (BasketAddOn & {
    title: string;
    saleId: string | null;
    selection: { label: string; value: string }[];
    shippingProfileId: string | null;
  })[] = [];
  if (picks.length > 0) {
    // Offered only where the page offers them: this storefront shows the
    // section, and the seller chose these for this product.
    const offered = isProductPageSectionShown(gate.productPage, "addOns")
      ? parseAddOnIds(gate.row.add_on_ids)
      : [];
    const ids = picks.map((pick) => pick.productId);
    if (
      picks.length > ADD_ONS_MAX ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !offered.includes(id))
    ) {
      return { ok: false, reason: "add_on_unavailable" };
    }
    const lines = await loadAddOns(admin, {
      ownerId: gate.ownerId,
      ids,
      isDigital,
      currency: line.currency,
      now: gate.now,
      unreadableSales: "busy",
    });
    if (lines === PAGE_BUSY) return { ok: false, reason: "add_on_unavailable" };
    for (const pick of picks) {
      const found = lines.find((candidate) => candidate.card.id === pick.productId);
      if (!found) return { ok: false, reason: "add_on_unavailable" };
      const chosen = strictSelection(found.card.optionGroups, pick.optionIds);
      if (!chosen) return { ok: false, reason: "add_on_unavailable" };
      const one = await resolveOrderQuantity(admin, pick.productId, 1);
      if (!one.ok) return { ok: false, reason: "add_on_unavailable" };
      const addOnSale = bestSale(found.sales, one.unitPriceCents, one.currency);
      extras.push({
        productId: pick.productId,
        title: found.row.title,
        regularUnitCents: one.unitPriceCents,
        saleUnitCents: addOnSale?.unitPriceCents ?? null,
        saleId: addOnSale?.sale.id ?? null,
        quantity: one.quantity,
        selection: optionSummaryRows(found.card.optionGroups, chosen),
        shippingProfileId: found.row.shipping_profile_id,
      });
    }
  }

  // The discount, priced from this read's regular price (the one the line was
  // just checked against), so a price change since the page loaded is priced
  // here, not there. The same sum the checkout page shows (lib/checkout/basket).
  const sale = bestSale(gate.sales, line.unitPriceCents, line.currency);
  const basket = priceBasket({
    main: {
      regularUnitCents: line.unitPriceCents,
      currency: line.currency,
      quantity: line.quantity,
      saleUnitCents: sale?.unitPriceCents ?? null,
      code: code?.value ?? null,
    },
    addOns: extras,
  });
  const priced = basket.main;
  const appliedId = priced.applied === "code" ? code?.id : priced.applied === "sale" ? sale?.sale.id : undefined;
  const addOns: QuotedAddOn[] = extras.map((extra, index) => {
    const lineAt = basket.addOns[index]!;
    return {
      productId: extra.productId,
      title: extra.title,
      regularUnitCents: extra.regularUnitCents,
      unitPriceCents: lineAt.unitPriceCents,
      quantity: extra.quantity,
      amountCents: lineAt.amountCents,
      discount:
        lineAt.applied === "sale" && extra.saleId && lineAt.discountCents > 0
          ? { id: extra.saleId, cents: lineAt.discountCents }
          : null,
      selection: extra.selection,
    };
  });
  const addOnsCents = basket.itemsCents - priced.itemsCents;

  let shippingCents: number | null = null;
  if (!isDigital) {
    // ONE parcel, charged once: the highest of its products' rates.
    const shipping = quoteOrderShipping(gate.shippingPolicy, {
      profileIds: [gate.row.shipping_profile_id, ...extras.map((extra) => extra.shippingProfileId)],
      country: request.country ?? "",
      // After discounts: free delivery is earned on what the buyer pays.
      subtotalCents: basket.itemsCents,
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
      regularUnitCents: line.unitPriceCents,
      unitPriceCents: priced.unitPriceCents,
      quantity: line.quantity,
      selection: optionSummaryRows(groups, selection),
      isDigital,
      subtotalCents: priced.subtotalCents,
      itemsCents: priced.itemsCents,
      addOns,
      addOnsCents,
      discount: appliedId && priced.discountCents > 0 ? { id: appliedId, cents: priced.discountCents } : null,
      credit: code ? { id: code.id, code: code.code } : null,
      shippingCents,
      totalCents: basket.itemsCents + (shippingCents ?? 0),
    },
  };
}
