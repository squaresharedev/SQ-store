import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { toCurrency } from "@/lib/format/money";
import type { Currency } from "@/types/product";

// READ-ONLY dashboard aggregates. Server Components / Route Handlers only
// (cookies() is Node-only — never middleware).
//
// The `orders` table and its columns are OWNED BY THE SEED/ORDERS WORK — this
// module never creates or alters it, and reads fail soft (calm zero states)
// while that table is still landing. Column contract (do not rename):
//   seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, product_title, product_price_cents,
//   created_at

export type OrderChannel = "embed" | "marketplace";
export type OrderStatus = "paid" | "refunded" | "disputed" | "pending";

/** The subset of order columns the dashboard reads. */
export type DashboardOrder = {
  product_title: string;
  channel: OrderChannel;
  status: OrderStatus;
  amount_cents: number;
  currency: string;
  created_at: string;
};

/** Integer cents keyed by currency — never summed across currencies. */
export type MoneyByCurrency = Partial<Record<Currency, number>>;

export type MetricWindow = {
  revenue: MoneyByCurrency;
  sales: number;
  aov: MoneyByCurrency;
};

/**
 * Direction of the last 30 days vs the 30 days before it — drives the sparkline
 * colour. `surge` (>=10x) is a deliberate purple easter egg for real breakouts.
 */
export type TrendTone = "up" | "down" | "flat" | "surge";

/** A bare trend line: daily values (oldest->newest) + its period-over-period tone. */
export type MetricTrend = {
  /** ~30 daily buckets over the last 30 days, oldest first. */
  points: number[];
  tone: TrendTone;
};

export type DashboardOrdersData = {
  /** False while the orders table hasn't landed (or a read failed). */
  available: boolean;
  last30d: MetricWindow;
  allTime: MetricWindow;
  /** Daily sales-count trend, last 30 days vs the 30 before. */
  salesTrend: MetricTrend;
  /** Daily average-order-value trend, last 30 days vs the 30 before. */
  aovTrend: MetricTrend;
  /** Latest ~5, any status. */
  recentOrders: DashboardOrder[];
  refundedCount: number;
  disputedCount: number;
};

/** Read cap — seeded/early data is far below this; revisit with real volume. */
const ORDERS_READ_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 30;
const THIRTY_DAYS_MS = TREND_DAYS * DAY_MS;
/** A 10x period-over-period jump trips the purple "surge" easter egg. */
const SURGE_RATIO = 10;

export { toCurrency };

/** Colour signal for a metric: last window vs the one before it. */
function trendTone(current: number, previous: number): TrendTone {
  // No prior baseline -> no ratio to speak of; any new activity reads as "up".
  if (previous <= 0) return current > 0 ? "up" : "flat";
  if (current >= previous * SURGE_RATIO) return "surge";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

/**
 * Paid orders bucketed into `TREND_DAYS` daily slots (oldest first) relative to
 * `now`. Orders outside the window are ignored; empty days stay 0.
 */
function dailyBuckets(orders: DashboardOrder[], now: number) {
  const revenue = new Array<number>(TREND_DAYS).fill(0);
  const count = new Array<number>(TREND_DAYS).fill(0);
  for (const order of orders) {
    const ageDays = Math.floor((now - new Date(order.created_at).getTime()) / DAY_MS);
    if (ageDays < 0 || ageDays >= TREND_DAYS) continue;
    const idx = TREND_DAYS - 1 - ageDays; // oldest -> newest
    revenue[idx] += order.amount_cents;
    count[idx] += 1;
  }
  return { revenue, count };
}

function addMoney(target: MoneyByCurrency, currency: string, cents: number) {
  const key = toCurrency(currency);
  target[key] = (target[key] ?? 0) + cents;
}

function emptyWindow(): MetricWindow {
  return { revenue: {}, sales: 0, aov: {} };
}

export function emptyOrdersData(available = false): DashboardOrdersData {
  return {
    available,
    last30d: emptyWindow(),
    allTime: emptyWindow(),
    salesTrend: { points: [], tone: "flat" },
    aovTrend: { points: [], tone: "flat" },
    recentOrders: [],
    refundedCount: 0,
    disputedCount: 0,
  };
}

function windowFromPaid(orders: DashboardOrder[]): MetricWindow {
  const window = emptyWindow();
  for (const order of orders) {
    addMoney(window.revenue, order.currency, order.amount_cents);
    window.sales += 1;
  }
  // AOV per currency: cross-currency averages would be meaningless.
  const counts: MoneyByCurrency = {};
  for (const order of orders) addMoney(counts, order.currency, 1);
  for (const [currency, revenue] of Object.entries(window.revenue)) {
    const count = counts[currency as Currency] ?? 0;
    if (count > 0) window.aov[currency as Currency] = Math.round(revenue / count);
  }
  return window;
}

/**
 * All dashboard order metrics in one owner-scoped read. The seller id comes
 * from the session (never from a caller); RLS enforces the same boundary at
 * the DB.
 */
export async function getDashboardOrders(): Promise<DashboardOrdersData> {
  const account = await getActiveAccount();
  if (!account) return emptyOrdersData();

  const supabase = await createClient();
  // The generated Database types don't include `orders` yet (owned by the
  // concurrent seed work), so read through an untyped client view against the
  // agreed column contract above. Scoped to the ACTIVE account's store.
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select("product_title, channel, status, amount_cents, currency, created_at")
    .eq("seller_id", account.accountId)
    .order("created_at", { ascending: false })
    .limit(ORDERS_READ_LIMIT);

  if (error) {
    // Table not created yet (or transient failure): the dashboard renders its
    // calm zero states instead of erroring.
    console.warn("[dashboard] orders read unavailable:", error.message);
    return emptyOrdersData();
  }

  // EUR-only for now: USD orders don't count anywhere on the dashboard until
  // multi-currency viewing/transacting ships. MoneyByCurrency stays multi-key
  // so that work is additive later, not a rewrite.
  const orders = ((data ?? []) as DashboardOrder[]).filter(
    (order) => toCurrency(order.currency) === "EUR",
  );
  const paid = orders.filter((order) => order.status === "paid");
  const now = Date.now();
  const cutoff = now - THIRTY_DAYS_MS;
  const cutoffPrev = now - THIRTY_DAYS_MS * 2;
  const paidLast30d = paid.filter(
    (order) => new Date(order.created_at).getTime() >= cutoff,
  );
  // The 30 days before last30d — the baseline every trend is measured against.
  const paidPrev30d = paid.filter((order) => {
    const time = new Date(order.created_at).getTime();
    return time >= cutoffPrev && time < cutoff;
  });
  const last30d = windowFromPaid(paidLast30d);
  const prev30d = windowFromPaid(paidPrev30d);

  // Sparkline series: daily buckets over the last 30 days (colour compares the
  // whole window to the prior one, not the noisy day-to-day points).
  const buckets = dailyBuckets(paidLast30d, now);
  const salesTrend: MetricTrend = {
    points: buckets.count,
    tone: trendTone(last30d.sales, prev30d.sales),
  };
  const aovTrend: MetricTrend = {
    points: buckets.revenue.map((rev, i) =>
      buckets.count[i] > 0 ? Math.round(rev / buckets.count[i]) : 0,
    ),
    tone: trendTone(last30d.aov.EUR ?? 0, prev30d.aov.EUR ?? 0),
  };

  return {
    available: true,
    last30d,
    allTime: windowFromPaid(paid),
    salesTrend,
    aovTrend,
    recentOrders: orders.slice(0, 5),
    refundedCount: orders.filter((o) => o.status === "refunded").length,
    disputedCount: orders.filter((o) => o.status === "disputed").length,
  };
}

export type ProductsSummary = {
  total: number;
  missingImage: { id: string; title: string }[];
};

/**
 * Lightweight product facts for status modules. Reads image_key directly
 * (rather than listProducts) so "missing image" reflects the DB, not whether
 * R2 credentials happen to be configured; RLS scopes rows to the owner.
 */
export async function getProductsSummary(): Promise<ProductsSummary> {
  const account = await getActiveAccount();
  if (!account) return { total: 0, missingImage: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, title, image_key")
    .eq("owner_id", account.accountId);
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return {
    total: data.length,
    missingImage: data
      .filter((row) => row.image_key === null)
      .map((row) => ({ id: row.id, title: row.title })),
  };
}
