import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
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

export type ChannelStats = { revenue: MoneyByCurrency; sales: number };

export type TopProduct = {
  title: string;
  revenue: MoneyByCurrency;
  sales: number;
};

export type DashboardOrdersData = {
  /** False while the orders table hasn't landed (or a read failed). */
  available: boolean;
  last30d: MetricWindow;
  allTime: MetricWindow;
  /** Paid orders only, all-time. */
  channelSplit: Record<OrderChannel, ChannelStats>;
  /** Latest ~5, any status. */
  recentOrders: DashboardOrder[];
  /** Top ~5 by paid revenue, all-time (product_title snapshot). */
  topProducts: TopProduct[];
  refundedCount: number;
  disputedCount: number;
};

/** Read cap — seeded/early data is far below this; revisit with real volume. */
const ORDERS_READ_LIMIT = 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function toCurrency(value: string): Currency {
  return value === "USD" ? "USD" : "EUR";
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
    channelSplit: {
      embed: { revenue: {}, sales: 0 },
      marketplace: { revenue: {}, sales: 0 },
    },
    recentOrders: [],
    topProducts: [],
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
  const user = await getUser();
  if (!user) return emptyOrdersData();

  const supabase = await createClient();
  // The generated Database types don't include `orders` yet (owned by the
  // concurrent seed work), so read through an untyped client view against the
  // agreed column contract above.
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select("product_title, channel, status, amount_cents, currency, created_at")
    .eq("seller_id", user.id)
    .order("created_at", { ascending: false })
    .limit(ORDERS_READ_LIMIT);

  if (error) {
    // Table not created yet (or transient failure): the dashboard renders its
    // calm zero states instead of erroring.
    console.warn("[dashboard] orders read unavailable:", error.message);
    return emptyOrdersData();
  }

  const orders = (data ?? []) as DashboardOrder[];
  const paid = orders.filter((order) => order.status === "paid");
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const paidLast30d = paid.filter(
    (order) => new Date(order.created_at).getTime() >= cutoff,
  );

  const channelSplit: Record<OrderChannel, ChannelStats> = {
    embed: { revenue: {}, sales: 0 },
    marketplace: { revenue: {}, sales: 0 },
  };
  for (const order of paid) {
    const channel = order.channel === "marketplace" ? "marketplace" : "embed";
    addMoney(channelSplit[channel].revenue, order.currency, order.amount_cents);
    channelSplit[channel].sales += 1;
  }

  const byTitle = new Map<string, TopProduct>();
  for (const order of paid) {
    const entry = byTitle.get(order.product_title) ?? {
      title: order.product_title,
      revenue: {},
      sales: 0,
    };
    addMoney(entry.revenue, order.currency, order.amount_cents);
    entry.sales += 1;
    byTitle.set(order.product_title, entry);
  }
  const topProducts = [...byTitle.values()]
    .sort((a, b) => maxRevenue(b.revenue) - maxRevenue(a.revenue))
    .slice(0, 5);

  return {
    available: true,
    last30d: windowFromPaid(paidLast30d),
    allTime: windowFromPaid(paid),
    channelSplit,
    recentOrders: orders.slice(0, 5),
    topProducts,
    refundedCount: orders.filter((o) => o.status === "refunded").length,
    disputedCount: orders.filter((o) => o.status === "disputed").length,
  };
}

/** Ranking key for top products: a product's largest single-currency revenue. */
function maxRevenue(revenue: MoneyByCurrency): number {
  return Math.max(0, ...Object.values(revenue));
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, title, image_key");
  if (error) throw new Error(`Failed to load products: ${error.message}`);
  return {
    total: data.length,
    missingImage: data
      .filter((row) => row.image_key === null)
      .map((row) => ({ id: row.id, title: row.title })),
  };
}
