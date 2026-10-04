import { lineTotalCents } from "@/lib/products/quantity";
import type { Currency } from "@/types/product";
import type { DiscountValue } from "@/types/discount";

/**
 * DISCOUNT ARITHMETIC, pure and client-safe.
 *
 * The checkout quote (lib/checkout/quote.ts) and the checkout form's preview
 * both price an order through `priceOrder`, exactly as they both price
 * delivery through quoteShipping: one function, so the total a buyer sees
 * before paying is the total the server charges.
 *
 * THE RULES
 *   - A sale lowers each item's price; a code lowers the order's items.
 *   - One discount per order, whichever leaves the buyer paying less. A code
 *     that does not beat the running sale changes nothing (but is still
 *     credited to its channel, see the quote).
 *   - Percent reductions round DOWN, so the price never ends up lower than
 *     the percentage promised.
 *   - A discount never takes what is paid for the items below
 *     MIN_PAYABLE_CENTS, the smallest amount a card payment can be.
 */

/** The smallest card payment: 50 cents (or 50 euro cents). A discount stops
 *  short of it rather than making an order nobody can pay for. */
export const MIN_PAYABLE_CENTS = 50;

/**
 * How much `value` takes off `amountCents`, in cents. 0 when it does not
 * apply: an amount in another currency, or nothing left above the floor.
 */
export function reductionCents(value: DiscountValue, amountCents: number, currency: Currency): number {
  if (value.type === "amount" && value.currency !== currency) return 0;
  const wanted =
    value.type === "percent"
      ? Math.floor((amountCents * value.percentOff) / 100)
      : value.amountOffCents;
  const room = Math.max(0, amountCents - MIN_PAYABLE_CENTS);
  return Math.max(0, Math.min(wanted, room));
}

/** One item's price under a sale. */
export function saleUnitPriceCents(value: DiscountValue, regularCents: number, currency: Currency): number {
  return regularCents - reductionCents(value, regularCents, currency);
}

/**
 * The sale that makes this product cheapest, with the price it makes, or
 * null when none lowers it. Ties keep the first, so the answer is stable for
 * a given list.
 */
export function bestSale<T extends { value: DiscountValue }>(
  sales: readonly T[],
  regularCents: number,
  currency: Currency,
): { sale: T; unitPriceCents: number } | null {
  let best: { sale: T; unitPriceCents: number } | null = null;
  for (const sale of sales) {
    const unitPriceCents = saleUnitPriceCents(sale.value, regularCents, currency);
    if (unitPriceCents < regularCents && (!best || unitPriceCents < best.unitPriceCents)) {
      best = { sale, unitPriceCents };
    }
  }
  return best;
}

export type PricedOrder = {
  /** Each item's price before any code: the sale price when the sale wins,
   *  else the regular price. */
  unitPriceCents: number;
  /** unitPriceCents x quantity. */
  subtotalCents: number;
  /** What the code takes off the subtotal when the code wins, else 0. */
  codeDiscountCents: number;
  /** What the items cost: subtotal minus the code's discount. Delivery is
   *  priced on this, and the platform fee is charged on it. */
  itemsCents: number;
  /** How much less than the regular price the items cost, whichever discount
   *  did it. What the order records as discount_cents. */
  discountCents: number;
  /** Which discount set the price. */
  applied: "sale" | "code" | null;
  /** A code was given and would apply, but the sale is as good or better. */
  codeOutdone: boolean;
};

/**
 * Price one order's items. `saleUnitCents` is the best running sale's price
 * per item (null without one); `code` is a code's terms (null without one).
 * The winner is decided on the ITEMS only, so it never depends on where the
 * parcel goes.
 */
export function priceOrder(input: {
  regularUnitCents: number;
  currency: Currency;
  quantity: number;
  saleUnitCents: number | null;
  code: DiscountValue | null;
}): PricedOrder {
  const { regularUnitCents, currency, quantity, code } = input;
  const regularSubtotal = lineTotalCents(regularUnitCents, quantity);
  const saleUnit =
    input.saleUnitCents !== null && input.saleUnitCents < regularUnitCents ? input.saleUnitCents : null;
  const saleSubtotal = saleUnit === null ? null : lineTotalCents(saleUnit, quantity);
  const codeOff = code ? reductionCents(code, regularSubtotal, currency) : 0;

  if (codeOff > 0 && (saleSubtotal === null || regularSubtotal - codeOff < saleSubtotal)) {
    return {
      unitPriceCents: regularUnitCents,
      subtotalCents: regularSubtotal,
      codeDiscountCents: codeOff,
      itemsCents: regularSubtotal - codeOff,
      discountCents: codeOff,
      applied: "code",
      codeOutdone: false,
    };
  }
  if (saleUnit !== null && saleSubtotal !== null) {
    return {
      unitPriceCents: saleUnit,
      subtotalCents: saleSubtotal,
      codeDiscountCents: 0,
      itemsCents: saleSubtotal,
      discountCents: regularSubtotal - saleSubtotal,
      applied: "sale",
      codeOutdone: codeOff > 0,
    };
  }
  return {
    unitPriceCents: regularUnitCents,
    subtotalCents: regularSubtotal,
    codeDiscountCents: 0,
    itemsCents: regularSubtotal,
    discountCents: 0,
    applied: null,
    codeOutdone: false,
  };
}
