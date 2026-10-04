import type { Currency } from "@/types/product";
import type { DiscountValue } from "@/types/discount";
import { saleUnitPriceCents } from "@/lib/discounts/pricing";

/**
 * THE "WAS" PRICE a sale may show. Pure.
 *
 * EU law (Price Indication Directive 98/6/EC art. 6a, the Omnibus rule): a shop
 * that announces a price reduction must state, as the earlier price, the
 * LOWEST price it applied in at least the 30 days before the reduction. Not
 * the regular price, not last week's: the lowest, including any earlier sale.
 *
 * So the answer is the minimum EFFECTIVE price (the regular price of the time,
 * less any other sale running then) over [start - 30 days, start). Both change
 * only at known instants (a price change in the history, another sale starting
 * or ending), so the minimum over the window is the minimum over those
 * instants plus the window's own start.
 *
 * WHEN IT ANSWERS NULL, the page shows the sale price as the plain price, with
 * no struck-through price and no badge. That is always lawful. It happens when:
 *   - the history does not reach back to the window's start (a new product, or
 *     history that began less than 30 days ago);
 *   - the currency changed inside the window (prices are not comparable).
 * Being wrong in the other direction (announcing a reduction the law does not
 * allow) is the mistake this module exists to make impossible.
 */

export const PRIOR_PRICE_WINDOW_DAYS = 30;
const WINDOW_MS = PRIOR_PRICE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** One row of product_price_history. */
export type PricePoint = { priceCents: number; currency: string; validFrom: string };

/** Another sale that covered this product, over its whole run. Archived
 *  sales count (their end is when they were stopped); a sale archived before
 *  it started never ran and is left out by the caller. */
export type PastSale = { value: DiscountValue; startsAt: string; endsAt: string | null };

/**
 * The lowest price applied in the 30 days before `saleStart`, or null when the
 * history cannot prove it.
 */
export function priorPriceCents(input: {
  history: readonly PricePoint[];
  otherSales: readonly PastSale[];
  saleStart: string;
  currency: Currency;
}): number | null {
  const end = Date.parse(input.saleStart);
  if (Number.isNaN(end)) return null;
  const start = end - WINDOW_MS;

  const points = input.history
    .map((point) => ({ ...point, at: Date.parse(point.validFrom) }))
    .filter((point) => !Number.isNaN(point.at) && point.at < end)
    .sort((a, b) => a.at - b.at);

  // The price at the window's start must be known.
  const opening = points.filter((point) => point.at <= start).at(-1);
  if (!opening) return null;
  const inWindow = points.filter((point) => point.at > start);
  if ([opening, ...inWindow].some((point) => point.currency !== input.currency)) return null;

  const priceAt = (instant: number): number =>
    (points.filter((point) => point.at <= instant).at(-1) ?? opening).priceCents;

  const sales = input.otherSales.map((sale) => ({
    value: sale.value,
    from: Date.parse(sale.startsAt),
    to: sale.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(sale.endsAt),
  }));

  const instants = new Set<number>([start]);
  for (const point of inWindow) instants.add(point.at);
  for (const sale of sales) {
    if (sale.from > start && sale.from < end) instants.add(sale.from);
    if (sale.to > start && sale.to < end) instants.add(sale.to);
  }

  let lowest = Number.POSITIVE_INFINITY;
  for (const instant of instants) {
    const regular = priceAt(instant);
    let effective = regular;
    for (const sale of sales) {
      if (sale.from <= instant && instant < sale.to) {
        effective = Math.min(effective, saleUnitPriceCents(sale.value, regular, input.currency));
      }
    }
    lowest = Math.min(lowest, effective);
  }
  return Number.isFinite(lowest) ? lowest : null;
}

/**
 * What a page may announce for a sale price: the "was" price and the percent,
 * or nulls when the reduction may not be shown (no proven prior price, or the
 * sale price is not actually lower than it). The percent is measured against
 * the prior price and rounded down, and below 1% it is left out.
 */
export function saleAnnouncement(
  priorCents: number | null,
  saleCents: number,
): { priorPriceCents: number | null; percentOff: number | null } {
  if (priorCents === null || priorCents <= saleCents) return { priorPriceCents: null, percentOff: null };
  const percent = Math.floor(((priorCents - saleCents) * 100) / priorCents);
  return { priorPriceCents: priorCents, percentOff: percent >= 1 ? percent : null };
}
