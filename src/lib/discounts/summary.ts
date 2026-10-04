import { discountStatus } from "@/lib/discounts/status";
import type {
  DiscountPerformance,
  DiscountStatus,
  DiscountView,
  MoneyTotal,
} from "@/types/discount";

/**
 * What the Discounts page shows, worked out from the store's discounts and
 * their orders. Pure, so the arithmetic is tested without a page.
 */

/** One discount in the list, with what it sold and where it stands. */
export type DiscountListItem = {
  discount: DiscountView;
  status: DiscountStatus;
  /** Every order that used it (what a usage limit counts). */
  uses: number;
  orders: number;
  revenue: MoneyTotal[];
};

/** One channel's orders. `label` is null for automatic sales, which have no
 *  channel of their own; the page names them. */
export type ChannelTotal = { label: string | null; orders: number };

export type DiscountsSummary = {
  items: DiscountListItem[];
  orders: number;
  revenue: MoneyTotal[];
  given: MoneyTotal[];
  /** Most orders first. Channels with no paid orders are left out. */
  channels: ChannelTotal[];
};

/** The order the list reads in: what is live, then what is coming, then what
 *  is switched off or spent, and what is over last. */
const STATUS_ORDER: readonly DiscountStatus[] = ["active", "scheduled", "paused", "used_up", "ended"];

/** What a discount is credited under: the channel it was shared on, else its
 *  own code. Automatic sales share one row. */
type Labelled = Pick<DiscountView, "kind" | "code" | "shareChannel">;

function channelOf(discount: Labelled): string | null {
  if (discount.kind !== "code") return null;
  return discount.shareChannel?.trim() || discount.code;
}

function addMoney(into: MoneyTotal[], from: readonly MoneyTotal[]): void {
  for (const { currency, cents } of from) {
    const existing = into.find((total) => total.currency === currency);
    if (existing) existing.cents += cents;
    else into.push({ currency, cents });
  }
}

/**
 * The page's data. `archived` labels the deleted discounts that still have
 * orders: their sales still came from a channel.
 */
export function summarizeDiscounts(
  discounts: readonly DiscountView[],
  performance: ReadonlyMap<string, DiscountPerformance>,
  archived: ReadonlyMap<string, Labelled>,
  now: Date = new Date(),
): DiscountsSummary {
  const items = discounts.map((discount): DiscountListItem => {
    const sold = performance.get(discount.id);
    return {
      discount,
      status: discountStatus(discount, sold?.uses ?? 0, now),
      uses: sold?.uses ?? 0,
      orders: sold?.orders ?? 0,
      revenue: sold?.revenue ?? [],
    };
  });
  // Stable, so discounts of one status keep the order they came in (newest first).
  items.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  const labels = new Map<string, Labelled>(archived);
  for (const discount of discounts) labels.set(discount.id, discount);

  let orders = 0;
  const revenue: MoneyTotal[] = [];
  const given: MoneyTotal[] = [];
  // Channels group case-insensitively ("instagram" and "Instagram" are one),
  // shown as first spelled.
  const channels = new Map<string, ChannelTotal>();
  for (const sold of performance.values()) {
    orders += sold.orders;
    addMoney(revenue, sold.revenue);
    addMoney(given, sold.given);
    const labelled = labels.get(sold.discountId);
    if (!labelled || sold.orders === 0) continue;
    const label = channelOf(labelled);
    const key = label === null ? "\u0000automatic" : label.toLowerCase();
    const channel = channels.get(key) ?? { label, orders: 0 };
    channel.orders += sold.orders;
    channels.set(key, channel);
  }

  return {
    items,
    orders,
    revenue,
    given,
    channels: [...channels.values()].sort((a, b) => b.orders - a.orders),
  };
}
