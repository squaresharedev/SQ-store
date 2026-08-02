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

const TREND_DAYS = 30;
/** A 10x period-over-period jump trips the purple "surge" easter egg. */
const SURGE_RATIO = 10;

export { toCurrency };

/** Shape of the jsonb payload dashboard_orders_aggregate returns. */
type DashboardPayload = {
  all_time: { revenue_cents: number; sales: number };
  last_30d: { revenue_cents: number; sales: number };
  prev_30d: { revenue_cents: number; sales: number };
  trend_days: { age_days: number; revenue_cents: number; sales: number }[];
  refunded_count: number;
  disputed_count: number;
  recent_orders: DashboardOrder[];
};

/** Colour signal for a metric: last window vs the one before it. */
function trendTone(current: number, previous: number): TrendTone {
  // No prior baseline -> no ratio to speak of; any new activity reads as "up".
  if (previous <= 0) return current > 0 ? "up" : "flat";
  if (current >= previous * SURGE_RATIO) return "surge";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

/** Pour SQL's per-age rows into TREND_DAYS slots, oldest first, zeros kept. */
function trendBuckets(rows: DashboardPayload["trend_days"]) {
  const revenue = new Array<number>(TREND_DAYS).fill(0);
  const count = new Array<number>(TREND_DAYS).fill(0);
  for (const row of rows) {
    if (row.age_days < 0 || row.age_days >= TREND_DAYS) continue;
    const idx = TREND_DAYS - 1 - row.age_days; // oldest -> newest
    revenue[idx] += row.revenue_cents;
    count[idx] += row.sales;
  }
  return { revenue, count };
}

function emptyWindow(): MetricWindow {
  return { revenue: {}, sales: 0, aov: {} };
}

/** EUR-keyed MetricWindow from the SQL window sums. The whole read is EUR-only
 *  (currency <> 'USD' inside the function), so a single key is correct; the
 *  MoneyByCurrency shape stays so multi-currency later is additive. */
function windowFromSums(sums: { revenue_cents: number; sales: number }): MetricWindow {
  const window = emptyWindow();
  if (sums.sales > 0) {
    window.revenue.EUR = sums.revenue_cents;
    window.sales = sums.sales;
    window.aov.EUR = Math.round(sums.revenue_cents / sums.sales);
  }
  return window;
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

/**
 * All dashboard order metrics in one RPC round-trip
 * (public.dashboard_orders_aggregate, SECURITY INVOKER: RLS enforces the
 * boundary inside the SQL, and a forged seller id returns zeros). No read cap:
 * the removed JS path aggregated the newest 1,000 rows and silently
 * under-reported all-time totals past that. EUR-only semantics live in the
 * SQL (currency <> 'USD', mirroring toCurrency exactly).
 */
export async function getDashboardOrders(): Promise<DashboardOrdersData> {
  const account = await getActiveAccount();
  if (!account) return emptyOrdersData();

  const supabase = await createClient();
  // Untyped rpc: the generated Database types predate these functions.
  const { data, error } = await (supabase as SupabaseClient).rpc(
    "dashboard_orders_aggregate",
    { p_seller_id: account.accountId },
  );

  if (error) {
    // THROW, do not soft-fail. "€0.00 all-time revenue" from a failed read is
    // indistinguishable from a real zero; error.tsx with a retry is honest.
    throw new Error(`Dashboard orders are unavailable right now: ${error.message}`);
  }

  const payload = data as DashboardPayload;
  const last30d = windowFromSums(payload.last_30d);
  const prev30d = windowFromSums(payload.prev_30d);

  // Sparkline series: daily buckets over the last 30 days (colour compares the
  // whole window to the prior one, not the noisy day-to-day points).
  const buckets = trendBuckets(payload.trend_days);
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
    allTime: windowFromSums(payload.all_time),
    salesTrend,
    aovTrend,
    recentOrders: payload.recent_orders,
    refundedCount: payload.refunded_count,
    disputedCount: payload.disputed_count,
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
