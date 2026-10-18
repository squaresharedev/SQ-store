import type { Currency } from "@/types/product";
import type { DiscountValue } from "@/types/discount";
import { saleUnitPriceCents } from "@/lib/discounts/pricing";

/**
 * THE LOWEST PRICE OF THE 30 DAYS BEFORE A SALE, and what a sale may say with
 * it. Pure.
 *
 * EU law (Price Indication Directive 98/6/EC art. 6a, the Omnibus rule): a shop
 * that announces a price reduction must state the LOWEST price it applied in
 * at least the 30 days before the reduction, and a percentage has to be
 * measured against THAT price (CJEU C-330/23). Not the regular price, not last
 * week's: the lowest, including any earlier sale.
 *
 * So the answer is the minimum EFFECTIVE price (the regular price of the time,
 * less any other sale running then) over [start - 30 days, start). Both change
 * only at known instants (a price change in the history, another sale starting
 * or ending), so the minimum over the window is the minimum over those
 * instants plus the window's own start.
 *
 * WHAT A PAGE DOES WITH IT (decided 2026-10-11: a sale nobody can see sells
 * nothing). The REGULAR price is always struck through beside the sale price.
 * This number is what keeps that honest:
 *   - the percentage on a badge is measured against it, never against the
 *     regular price, and is left out when it cannot be proved or is under 1%;
 *   - where it differs from the regular price, the product page says it in
 *     words beside the struck price ("Lowest price in the 30 days before this
 *     sale: ...").
 *
 * WHEN IT ANSWERS NULL the lowest price is not known, so no percentage is
 * shown and the page calls the struck price what it is, the regular price:
 *   - the history reaches back neither to the window's start nor to the day
 *     the product was listed (a product whose records began after it did);
 *   - the currency changed inside the window (prices are not comparable).
 *
 * A PRODUCT YOUNGER THAN THE WINDOW has a lowest price all the same: the
 * lowest it has had since it was listed (art. 6a(4): the period may be shorter
 * for a product on the market under 30 days). It counts only when the history
 * begins where the product does, so every price it ever had is on record.
 */

export const PRIOR_PRICE_WINDOW_DAYS = 30;
const WINDOW_MS = PRIOR_PRICE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** How far after a product's listing its first price may be recorded and
 *  still count as "from the start". The two are written in one transaction
 *  (20261004_discounts.sql), so this is slack, nothing more. */
const LISTING_SLACK_MS = 60 * 1000;

/** One row of product_price_history. */
export type PricePoint = { priceCents: number; currency: string; validFrom: string };

/** Another sale that covered this product, over its whole run. Archived
 *  sales count (their end is when they were stopped); a sale archived before
 *  it started never ran and is left out by the caller. */
export type PastSale = { value: DiscountValue; startsAt: string; endsAt: string | null };

/**
 * The lowest price applied in the 30 days before `saleStart` (or since the
 * product was listed, when that is more recent), or null when the history
 * cannot prove it.
 */
export function priorPriceCents(input: {
  history: readonly PricePoint[];
  otherSales: readonly PastSale[];
  saleStart: string;
  currency: Currency;
  /** When the product was listed (products.created_at), or null when not
   *  known. Only read for a product whose history is shorter than the window. */
  listedAt?: string | null;
}): number | null {
  const end = Date.parse(input.saleStart);
  if (Number.isNaN(end)) return null;

  const points = input.history
    .map((point) => ({ ...point, at: Date.parse(point.validFrom) }))
    .filter((point) => !Number.isNaN(point.at) && point.at < end)
    .sort((a, b) => a.at - b.at);

  // The price at the window's start must be known: on record from before it,
  // or the window starts where the product does.
  const thirtyDaysBefore = end - WINDOW_MS;
  const onRecord = points.filter((point) => point.at <= thirtyDaysBefore).at(-1);
  const first = points[0];
  const listed = input.listedAt ? Date.parse(input.listedAt) : Number.NaN;
  const sinceListing = !onRecord && first && !Number.isNaN(listed) && first.at <= listed + LISTING_SLACK_MS;
  if (!onRecord && !sinceListing) return null;
  const opening = onRecord ?? first;
  const start = onRecord ? thirtyDaysBefore : opening.at;

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
 * What a page may say about a sale beyond striking the regular price through:
 * the lowest price of the 30 days before (null when the records do not prove
 * one), and the percentage, measured against that price and rounded down. No
 * percentage when the lowest price is unknown, when the sale price is not
 * lower than it (a sale as deep ran in those 30 days), or under 1%.
 */
export function saleAnnouncement(
  priorCents: number | null,
  saleCents: number,
): { priorPriceCents: number | null; percentOff: number | null } {
  if (priorCents === null || priorCents <= saleCents) return { priorPriceCents: priorCents, percentOff: null };
  const percent = Math.floor(((priorCents - saleCents) * 100) / priorCents);
  return { priorPriceCents: priorCents, percentOff: percent >= 1 ? percent : null };
}
