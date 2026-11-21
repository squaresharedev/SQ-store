import { lineTotalCents } from "@/lib/products/quantity";
import type { Currency } from "@/types/product";
import type { DiscountKind, DiscountValue } from "@/types/discount";

/**
 * DISCOUNT ARITHMETIC, pure and client-safe.
 *
 * The checkout quote (lib/checkout/quote.ts), the checkout form's preview and
 * the cart all price an order's items through `priceLines`, exactly as they
 * all price delivery through quoteShipping: one function, so the total a buyer
 * sees before paying is the total the server charges.
 *
 * THE RULES
 *   - A sale lowers each item's price; a code lowers the order's items.
 *   - One discount per item, never both. Over the items a code covers, the
 *     code competes with their running sales AS ONE BLOCK: whichever leaves
 *     the buyer paying less for those items wins. Items the code does not
 *     cover keep their own sale. For an order of one product this is exactly
 *     "one discount per order, the lower of the sale and the code". A code
 *     that does not win changes nothing (but is still credited to its
 *     channel, see the quote).
 *   - An amount off comes off ONCE per order, spread over the items it covers
 *     in proportion to their price, so every line's amount (what a refund
 *     gives back, what Stripe lists) adds up to the total exactly.
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

/**
 * How much a sale takes off a product's regular price, in whole percent, as a
 * buyer reads it beside that price struck through: a percent sale's own figure
 * where it applied in full, otherwise the share that came off rounded down, so
 * it never says more came off than did. Null under 1%, or when nothing does.
 */
export function offerPercentOff(value: DiscountValue, regularCents: number, currency: Currency): number | null {
  const reduction = reductionCents(value, regularCents, currency);
  if (reduction <= 0 || regularCents <= 0) return null;
  if (value.type === "percent" && reduction === Math.floor((regularCents * value.percentOff) / 100)) {
    return value.percentOff;
  }
  const percent = Math.floor((reduction * 100) / regularCents);
  return percent >= 1 ? percent : null;
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

/**
 * What ONE of a product costs under a discount, bought on its own: a sale's
 * price for the item, or a code applied to an order of just that item. This is
 * what the dashboard tells a SELLER ("this costs that": the form's example, a
 * discount's product list). It is never what an order is charged, which
 * priceOrder decides from the real quantity and whichever discount wins.
 */
export function priceOfOne(
  kind: DiscountKind,
  value: DiscountValue,
  regularCents: number,
  currency: Currency,
): number {
  return kind === "automatic"
    ? saleUnitPriceCents(value, regularCents, currency)
    : priceOrder({ regularUnitCents: regularCents, currency, quantity: 1, saleUnitCents: null, code: value })
        .itemsCents;
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
 * Price one product's items bought on their own: priceLines for an order of
 * one line. `saleUnitCents` is the best running sale's price per item (null
 * without one); `code` is a code's terms (null without one), taken to cover
 * the product.
 */
export function priceOrder(input: {
  regularUnitCents: number;
  currency: Currency;
  quantity: number;
  saleUnitCents: number | null;
  code: DiscountValue | null;
}): PricedOrder {
  const priced = priceLines({
    currency: input.currency,
    code: input.code,
    lines: [
      {
        regularUnitCents: input.regularUnitCents,
        saleUnitCents: input.saleUnitCents,
        quantity: input.quantity,
        coveredByCode: true,
      },
    ],
  });
  const line = priced.lines[0]!;
  return {
    unitPriceCents: line.unitPriceCents,
    subtotalCents: line.subtotalCents,
    codeDiscountCents: line.codeCents,
    itemsCents: line.amountCents,
    discountCents: line.discountCents,
    applied: line.applied,
    codeOutdone: priced.codeOutdone,
  };
}

/** One line of an order, as priceLines takes it. */
export type LineToPrice = {
  regularUnitCents: number;
  /** The best running sale's price for one, or null without one. */
  saleUnitCents: number | null;
  quantity: number;
  /** The code's scope names this product (or the code is for everything).
   *  Ignored without a code. */
  coveredByCode: boolean;
};

export type PricedLine = {
  /** One item's price before any code: the sale's when the sale priced the
   *  line, else the regular price. */
  unitPriceCents: number;
  /** unitPriceCents x quantity. */
  subtotalCents: number;
  /** This line's share of what the code took off (0 unless the code won). */
  codeCents: number;
  /** What the line is charged: subtotal minus its share of the code. */
  amountCents: number;
  /** How much less than the regular price the line costs, whichever discount
   *  did it. What the order records as the line's discount_cents. */
  discountCents: number;
  /** Which discount set this line's price. */
  applied: "sale" | "code" | null;
};

export type PricedLines = {
  /** In the order they were given. */
  lines: PricedLine[];
  /** Sum of the lines' subtotals: the items before any code. */
  subtotalCents: number;
  /** What the code took off the order (0 unless it won). */
  codeCents: number;
  /** What the items cost: what delivery's threshold reads and the fee is
   *  charged on, with delivery added to make the total. */
  itemsCents: number;
  /** A code covers some of these items and would take something off, but
   *  their sales do as well or better, so it changed nothing. */
  codeOutdone: boolean;
};

/**
 * Price an order's items: every line at its own sale, then the code (if any)
 * against the sales of the lines it covers, as one block. See THE RULES.
 */
export function priceLines(input: {
  currency: Currency;
  code: DiscountValue | null;
  lines: readonly LineToPrice[];
}): PricedLines {
  const { currency, code, lines } = input;
  const regular = lines.map((line) => lineTotalCents(line.regularUnitCents, line.quantity));
  const saleUnit = lines.map((line) =>
    line.saleUnitCents !== null && line.saleUnitCents < line.regularUnitCents ? line.saleUnitCents : null,
  );
  const bySale = lines.map((line, index) => {
    const unit = saleUnit[index];
    return unit === null || unit === undefined ? regular[index]! : lineTotalCents(unit, line.quantity);
  });

  const covered = lines.map((line) => code !== null && line.coveredByCode);
  let regularCovered = 0;
  let salesCovered = 0;
  lines.forEach((_, index) => {
    if (!covered[index]) return;
    regularCovered += regular[index]!;
    salesCovered += bySale[index]!;
  });
  const codeOff = code && regularCovered > 0 ? reductionCents(code, regularCovered, currency) : 0;
  const codeWins = codeOff > 0 && regularCovered - codeOff < salesCovered;
  const shares = codeWins
    ? allocateCents(
        codeOff,
        regular.map((cents, index) => (covered[index] ? cents : 0)),
      )
    : regular.map(() => 0);

  const priced: PricedLine[] = lines.map((line, index) => {
    const regularCents = regular[index]!;
    if (codeWins && covered[index]) {
      const share = shares[index]!;
      return {
        unitPriceCents: line.regularUnitCents,
        subtotalCents: regularCents,
        codeCents: share,
        amountCents: regularCents - share,
        discountCents: share,
        applied: "code",
      };
    }
    const unit = saleUnit[index];
    if (unit !== null && unit !== undefined) {
      const amount = bySale[index]!;
      return {
        unitPriceCents: unit,
        subtotalCents: amount,
        codeCents: 0,
        amountCents: amount,
        discountCents: regularCents - amount,
        applied: "sale",
      };
    }
    return {
      unitPriceCents: line.regularUnitCents,
      subtotalCents: regularCents,
      codeCents: 0,
      amountCents: regularCents,
      discountCents: 0,
      applied: null,
    };
  });

  const subtotalCents = priced.reduce((total, line) => total + line.subtotalCents, 0);
  const itemsCents = priced.reduce((total, line) => total + line.amountCents, 0);
  return {
    lines: priced,
    subtotalCents,
    codeCents: codeWins ? codeOff : 0,
    itemsCents,
    codeOutdone: codeOff > 0 && !codeWins,
  };
}

/**
 * Split `total` cents over `weights` in proportion, in whole cents, so the
 * parts add up to `total` exactly: each part rounds down, and the cents left
 * over go one each to the parts that lost the most to rounding (the earlier
 * part on a tie, so the answer is stable). A part is never more than its
 * weight while `total` is no more than the weights' sum. BigInt for the
 * products: 20 lines of large amounts would overflow a double's exact range.
 */
export function allocateCents(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const bigTotal = BigInt(total);
  const bigSum = BigInt(sum);
  const parts = weights.map((weight) => {
    const product = bigTotal * BigInt(weight);
    return { base: Number(product / bigSum), remainder: product % bigSum };
  });
  let left = total - parts.reduce((acc, part) => acc + part.base, 0);
  const order = parts
    .map((part, index) => ({ index, remainder: part.remainder }))
    .filter((entry) => weights[entry.index]! > 0)
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const result = parts.map((part) => part.base);
  for (const entry of order) {
    if (left <= 0) break;
    result[entry.index] = (result[entry.index] ?? 0) + 1;
    left -= 1;
  }
  return result;
}
