// HOW MANY, and who is allowed to say so.
//
// Client-safe and pure, like lib/stock/badge.ts: the picker imports it, the
// public builder imports it, and the server-side authority
// (lib/products/order-quantity.ts) imports it. Nothing here reads a request or
// a database; it only turns numbers that are already in hand into the one
// answer every layer must agree on.
//
// THE RULE THIS FILE EXISTS TO KEEP: a quantity that arrives from a buyer is
// a REQUEST, never a fact. It reaches this module as an unknown, leaves as a
// bounded integer, and the ceiling it is bounded against always comes from a
// product row the server read for itself. The picker's `<option>` list, the
// `?q=` parameter and any future checkout body are all the same untrusted
// input, and they are all measured against the same stored `max_per_order`.

import { deriveStockBadge } from "@/lib/stock/badge";
import { MAX_PER_ORDER_DEFAULT, PURCHASE_QUANTITY_MAX } from "@/lib/validation/product";

/** `?q=` carries the chosen quantity, so a shared or reloaded link opens on
 *  the same order the sender was looking at. Declared beside the other product
 *  page parameters' reasoning (see lib/storefront/product-page-url.ts): the
 *  route reads it on the server, the picker writes it on the client, so it
 *  cannot live in a "use client" module. */
export const QUANTITY_QUERY_PARAM = "q";

/**
 * What a quantity may look like as TEXT: one to three plain digits, and
 * nothing else.
 *
 * Deliberately narrower than "something Number() can read". `Number("1e9")` is
 * a billion and `Number(" 4 ")` is four, so a length check alone would let an
 * address bar hand this module values no picker could ever produce. Three
 * digits covers every legal quantity; anything else is a probe, not an order,
 * and reads as one unit.
 */
const QUANTITY_PARAM_PATTERN = /^[0-9]{1,3}$/;

/**
 * A product's OWN ceiling, forced into the legal range.
 *
 * Never trusts the stored number raw. The column has a CHECK and the schema has
 * a bound, but this is the value a buyer's request is measured against, so a
 * row that predates the constraint, or one written by a service-role path that
 * skipped the schema, is corrected here rather than believed. Anything absent
 * or nonsensical falls back to the same default the column has.
 */
export function productQuantityCap(maxPerOrder: number | null | undefined): number {
  if (typeof maxPerOrder !== "number" || !Number.isFinite(maxPerOrder)) {
    return MAX_PER_ORDER_DEFAULT;
  }
  return Math.min(PURCHASE_QUANTITY_MAX, Math.max(1, Math.trunc(maxPerOrder)));
}

/** Exactly the product facts a limit is derived from. */
export type QuantityLimitFields = {
  maxPerOrder: number | null;
  trackStock: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number;
};

/**
 * THE CEILING THE PICKER MAY OFFER, and the one number about quantity that is
 * allowed to reach a buyer. `0` means there is nothing to pick (sold out).
 *
 * WHY THIS IS NOT `min(cap, stockQuantity)`. Clamping the dropdown to the units
 * on hand would publish the units on hand: a buyer who sees the list stop at 7
 * has learned the shelf holds 7, and lib/stock/public.ts exists precisely to
 * stop raw stock numbers reaching non-owners. So the shelf narrows this list
 * only where the page has ALREADY said the number out loud:
 *
 *   not tracking      the seller's cap. Nothing to leak.
 *   sold out          0. The page says so anyway and the button is disabled.
 *   low stock, shown  min(cap, remaining). "Only 3 left" is already printed
 *                     beside the picker, so stopping the list at 3 tells a
 *                     buyer nothing the page did not.
 *   anything else     the seller's cap. The count stays private, and a buyer
 *                     may therefore pick more than the shelf holds.
 *
 * `stockShown` is the STOREFRONT's own switch (productPage.showStock), and it
 * is what makes that rule exact rather than approximately right. A seller who
 * turns stock display off has decided buyers may not know how many are left,
 * and a dropdown quietly stopping at 2 would tell them anyway — in a control
 * nobody thinks of as a disclosure. It defaults to OFF wherever a caller does
 * not pass it, because the failure that matters here is publishing a number
 * nobody meant to publish.
 *
 * Sold out is deliberately NOT gated on it: the button reads "Sold out"
 * whatever the switch says, so zero adds nothing a buyer cannot already see.
 *
 * The last row is a deliberate trade, not an oversight: the request is refused
 * by resolveOrderQuantity against the real number, which is where an oversell
 * has to be caught regardless — a picker clamped to stock would still be a
 * stale list by the time the button is pressed.
 */
export function publicQuantityLimit(
  fields: QuantityLimitFields,
  options: { stockShown?: boolean } = {},
): number {
  const cap = productQuantityCap(fields.maxPerOrder);
  const badge = deriveStockBadge({
    trackStock: fields.trackStock,
    stockQuantity: fields.stockQuantity,
    lowStockThreshold: fields.lowStockThreshold,
  });
  if (!badge) return cap;
  if (badge.state === "sold_out") return 0;
  if (badge.state === "low_stock" && options.stockShown === true) {
    return Math.min(cap, badge.remaining);
  }
  return cap;
}

/**
 * A quantity a buyer asked for, as an integer inside `[1, limit]`, or `1` when
 * the request is absent, malformed, or out of range.
 *
 * CLAMPING IS FOR DISPLAY ONLY. This is what the page renders and what the
 * picker holds, so a hand-edited `?q=999` opens on a legal page rather than an
 * error. It is NOT what authorizes a sale: resolveOrderQuantity REFUSES an
 * over-limit quantity instead of quietly lowering it, because silently
 * charging someone for fewer units than the number they pressed is its own
 * kind of wrong.
 */
export function clampQuantity(requested: unknown, limit: number): number {
  const ceiling = Math.max(1, Math.min(PURCHASE_QUANTITY_MAX, Math.trunc(limit) || 1));
  const value =
    typeof requested === "number"
      ? requested
      : typeof requested === "string" && QUANTITY_PARAM_PATTERN.test(requested)
        ? Number(requested)
        : Number.NaN;
  if (!Number.isFinite(value)) return 1;
  const whole = Math.trunc(value);
  if (whole < 1) return 1;
  return Math.min(whole, ceiling);
}

/**
 * What `?q=` asks for. A separate entry point from clampQuantity so the route
 * reads like the option parameter beside it, and so a repeated parameter (which
 * arrives as an array) resolves the same way an option one does: one address
 * bar can only mean one order.
 */
export function requestedQuantity(
  raw: string | string[] | undefined,
  limit: number,
): number {
  return clampQuantity(Array.isArray(raw) ? raw[0] : raw, limit);
}

/**
 * Integer cents for `quantity` units. Multiplication on integers, never a
 * float: PURCHASE_QUANTITY_MAX and PRICE_CENTS_MAX together bound this at
 * 10^10, which is exact in a JS number and nowhere near losing a cent.
 */
export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}
