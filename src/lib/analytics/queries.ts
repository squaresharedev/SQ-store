import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { toCurrency } from "@/lib/format/money";
import type { OrderChannel, OrderStatus } from "@/types/order-view";
import {
  TOP_PRODUCTS_LIMIT,
  type AnalyticsData,
  type AnalyticsRange,
  type ChannelSlice,
  type RevenuePoint,
  type StatusSlice,
  type TopProduct,
  type WeekdaySlice,
} from "@/lib/analytics/types";

// READ-ONLY analytics aggregates. Server Components / Route Handlers only
// (cookies() is Node-only — never middleware).
//
// The `orders` table and its columns are OWNED BY THE SEED/ORDERS WORK — this
// module never creates or alters it, and reads fail soft (calm zero states)
// while that table is still landing. Column contract (do not rename):
//   seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, product_title, product_price_cents,
//   created_at

/** The subset of order columns analytics reads. */
type AnalyticsOrder = {
  product_title: string;
  channel: string;
  status: string;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  buyer_email: string | null;
  created_at: string;
};

/** Read cap — seeded/early data is far below this; revisit with real volume. */
const ORDERS_READ_LIMIT = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ranges up to ~3 months bucket by day; anything longer buckets by month. */
const MAX_DAILY_SPAN_DAYS = 92;

/** Coerce an unknown channel string to a valid OrderChannel. */
function toChannel(value: unknown): OrderChannel {
  return value === "marketplace" ? "marketplace" : "embed";
}

/** Fixed status display order for the breakdown — zeros included. */
const STATUS_ORDER: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];

/** Mon-first weekday labels; getUTCDay() is Sun-first, hence the remap. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** UTC ms for an ISO "YYYY-MM-DD" day start. Deterministic — no locale. */
function dayStartUtc(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** ISO "YYYY-MM-DD" for a UTC ms timestamp. */
function toIsoDay(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** ISO "YYYY-MM-DD" of the first day of the month containing `isoDate`. */
function toMonthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/**
 * Revenue trend buckets, oldest → newest, empty buckets included as 0.
 * Day buckets for spans ≤ MAX_DAILY_SPAN_DAYS, month buckets beyond that.
 * All-time ranges start at the earliest returned order.
 */
function buildSeries(orders: AnalyticsOrder[], range: AnalyticsRange): RevenuePoint[] {
  if (orders.length === 0) return [];

  // Orders arrive oldest-first; created_at is ISO so slicing the date part is
  // deterministic UTC date math.
  const start = range.from ?? orders[0].created_at.slice(0, 10);
  const end = range.to ?? toIsoDay(Date.now());
  const startMs = dayStartUtc(start);
  const endMs = dayStartUtc(end);
  if (endMs < startMs) return [];

  const spanDays = Math.floor((endMs - startMs) / DAY_MS);
  const byMonth = spanDays > MAX_DAILY_SPAN_DAYS;

  // Empty buckets first, then pour the orders in.
  const buckets = new Map<string, RevenuePoint>();
  if (byMonth) {
    const [endY, endM] = toMonthStart(end).split("-").map(Number);
    let [y, m] = toMonthStart(start).split("-").map(Number);
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m).padStart(2, "0")}-01`;
      buckets.set(key, { date: key, revenueCents: 0, sales: 0, aovCents: 0 });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else {
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const key = toIsoDay(ms);
      buckets.set(key, { date: key, revenueCents: 0, sales: 0, aovCents: 0 });
    }
  }

  for (const order of orders) {
    const day = order.created_at.slice(0, 10);
    const bucket = buckets.get(byMonth ? toMonthStart(day) : day);
    if (!bucket) continue;
    bucket.revenueCents += order.amount_cents;
    bucket.sales += 1;
  }
  // Per-bucket AOV once the sums are in — integer cents, 0 for empty buckets.
  for (const bucket of buckets.values()) {
    bucket.aovCents =
      bucket.sales > 0 ? Math.round(bucket.revenueCents / bucket.sales) : 0;
  }
  return [...buckets.values()];
}

/** Always both channels, embed first, zeros included. */
function buildChannels(orders: AnalyticsOrder[]): ChannelSlice[] {
  const slices: Record<OrderChannel, ChannelSlice> = {
    embed: { channel: "embed", revenueCents: 0, sales: 0 },
    marketplace: { channel: "marketplace", revenueCents: 0, sales: 0 },
  };
  for (const order of orders) {
    const slice = slices[toChannel(order.channel)];
    slice.revenueCents += order.amount_cents;
    slice.sales += 1;
  }
  return [slices.embed, slices.marketplace];
}

/** Top products by paid revenue (product_title snapshot — rename-resilient). */
function buildTopProducts(orders: AnalyticsOrder[]): TopProduct[] {
  const byTitle = new Map<string, TopProduct>();
  for (const order of orders) {
    const entry = byTitle.get(order.product_title) ?? {
      title: order.product_title,
      revenueCents: 0,
      sales: 0,
    };
    entry.revenueCents += order.amount_cents;
    entry.sales += 1;
    byTitle.set(order.product_title, entry);
  }
  return [...byTitle.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, TOP_PRODUCTS_LIMIT);
}

/** Paid sales by day of week, Mon..Sun, zeros included. */
function buildWeekdays(orders: AnalyticsOrder[]): WeekdaySlice[] {
  const slices = WEEKDAYS.map((weekday) => ({
    weekday,
    sales: 0,
    revenueCents: 0,
  }));
  for (const order of orders) {
    // getUTCDay(): 0 Sun .. 6 Sat -> Mon-first index.
    const dow = new Date(order.created_at).getUTCDay();
    const slice = slices[(dow + 6) % 7];
    slice.sales += 1;
    slice.revenueCents += order.amount_cents;
  }
  return slices;
}

/** Order mix by status across ALL orders in range, fixed order, zeros kept. */
function buildStatuses(orders: AnalyticsOrder[]): StatusSlice[] {
  const counts = new Map<OrderStatus, number>(
    STATUS_ORDER.map((status) => [status, 0]),
  );
  for (const order of orders) {
    const status = STATUS_ORDER.includes(order.status as OrderStatus)
      ? (order.status as OrderStatus)
      : "pending";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return STATUS_ORDER.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

/** Distinct + repeat paid buyers, keyed on the lowercased email snapshot. */
function buildBuyers(orders: AnalyticsOrder[]): {
  uniqueBuyers: number;
  repeatBuyers: number;
} {
  const perBuyer = new Map<string, number>();
  for (const order of orders) {
    const email = order.buyer_email?.trim().toLowerCase();
    if (!email) continue;
    perBuyer.set(email, (perBuyer.get(email) ?? 0) + 1);
  }
  let repeatBuyers = 0;
  for (const count of perBuyer.values()) {
    if (count >= 2) repeatBuyers += 1;
  }
  return { uniqueBuyers: perBuyer.size, repeatBuyers };
}

/** Inclusive days the data window covers (all-time starts at the earliest
 *  order). 0 when there is nothing to measure. */
function rangeDays(orders: AnalyticsOrder[], range: AnalyticsRange): number {
  const start = range.from ?? orders[0]?.created_at.slice(0, 10);
  if (!start) return 0;
  const end = range.to ?? toIsoDay(Date.now());
  const span = Math.floor((dayStartUtc(end) - dayStartUtc(start)) / DAY_MS);
  return span < 0 ? 0 : span + 1;
}

export function emptyAnalyticsData(available = false): AnalyticsData {
  return {
    available,
    totals: {
      revenueCents: 0,
      sales: 0,
      aovCents: 0,
      feesCents: 0,
      netRevenueCents: 0,
      uniqueBuyers: 0,
      repeatBuyers: 0,
      refundedCount: 0,
      refundedCents: 0,
      rangeDays: 0,
      currency: "EUR",
    },
    series: [],
    channels: [
      { channel: "embed", revenueCents: 0, sales: 0 },
      { channel: "marketplace", revenueCents: 0, sales: 0 },
    ],
    topProducts: [],
    weekdays: WEEKDAYS.map((weekday) => ({ weekday, sales: 0, revenueCents: 0 })),
    statuses: STATUS_ORDER.map((status) => ({ status, count: 0 })),
  };
}

/**
 * All analytics aggregates in one owner-scoped read of the range's orders
 * (every status — refund rate and the status mix need the non-paid rows;
 * money/series metrics use the paid subset only). The seller id comes from
 * the session (never from a caller); RLS enforces the same boundary at the
 * DB.
 */
export async function getAnalytics(range: AnalyticsRange): Promise<AnalyticsData> {
  const account = await getActiveAccount();
  if (!account) return emptyAnalyticsData();

  const supabase = await createClient();
  // The generated Database types don't include `orders` yet (owned by the
  // concurrent seed work), so read through an untyped client view against the
  // agreed column contract above. Scoped to the ACTIVE account's store.
  let query = (supabase as SupabaseClient)
    .from("orders")
    .select(
      "product_title, channel, status, amount_cents, platform_fee_cents, currency, buyer_email, created_at",
    )
    .eq("seller_id", account.accountId);
  if (range.from) query = query.gte("created_at", `${range.from}T00:00:00Z`);
  if (range.to) query = query.lte("created_at", `${range.to}T23:59:59.999Z`);
  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(ORDERS_READ_LIMIT);

  if (error) {
    // Table not created yet (or transient failure): the analytics page renders
    // its calm zero states instead of erroring.
    console.warn("[analytics] orders read unavailable:", error.message);
    return emptyAnalyticsData();
  }

  // EUR-only for now, same rule as the dashboard: USD orders don't count
  // anywhere until multi-currency viewing/transacting ships.
  const orders = ((data ?? []) as AnalyticsOrder[]).filter(
    (order) => toCurrency(order.currency) === "EUR",
  );
  const paid = orders.filter((order) => order.status === "paid");
  const refunded = orders.filter((order) => order.status === "refunded");

  // All money in integer cents — no floats ever.
  const revenueCents = paid.reduce((sum, order) => sum + order.amount_cents, 0);
  const feesCents = paid.reduce(
    (sum, order) => sum + order.platform_fee_cents,
    0,
  );
  const refundedCents = refunded.reduce(
    (sum, order) => sum + order.amount_cents,
    0,
  );
  const sales = paid.length;

  return {
    available: true,
    totals: {
      revenueCents,
      sales,
      aovCents: sales > 0 ? Math.round(revenueCents / sales) : 0,
      feesCents,
      netRevenueCents: revenueCents - feesCents,
      ...buildBuyers(paid),
      refundedCount: refunded.length,
      refundedCents,
      rangeDays: rangeDays(orders, range),
      currency: "EUR",
    },
    series: buildSeries(paid, range),
    channels: buildChannels(paid),
    topProducts: buildTopProducts(paid),
    weekdays: buildWeekdays(paid),
    statuses: buildStatuses(orders),
  };
}
