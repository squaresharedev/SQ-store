import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { escapeIlike } from "@/lib/supabase/ilike";
import { getActiveAccount } from "@/lib/team/account-context";
import { parseOrderSelection } from "@/lib/orders/selection";
import { parseShipTo } from "@/lib/orders/ship-to";
import { parseFulfilment } from "@/lib/orders/fulfilment";
import type {
  OrderView,
  OrderFilters,
  OrderSort,
  OrderChannel,
  OrderStatus,
  OrdersView,
  Paginated,
} from "@/types/order-view";

// READ-ONLY orders reads. Server Components / Route Handlers only (cookies()
// is Node-only — never middleware). Orders are WRITTEN in exactly two places:
// the order writer (lib/orders/record.ts, service role) and the seller's
// "mark as shipped" (lib/orders/actions.ts, through public.order_mark_shipped).
//
// Reads go through an untyped client cast against the column contract below,
// which predates `orders` appearing in the generated types. Column contract
// (do not rename):
//   id, seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, buyer_email, product_title,
//   product_price_cents, selected_options, created_at, quantity, ship_to,
//   buyer_locale, fulfilment_status, shipped_at, tracking_number,
//   checkout_session_id

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Return an empty paginated envelope with the given page/pageSize echoed back. */
function emptyPage(page: number, pageSize: number): Paginated<OrderView> {
  return { rows: [], total: 0, page, pageSize };
}

/** Coerce an unknown channel string to a valid OrderChannel. */
function toChannel(value: unknown): OrderChannel {
  return value === "marketplace" ? "marketplace" : "embed";
}

/** Coerce an unknown status string to a valid OrderStatus. */
function toStatus(value: unknown): OrderStatus {
  const VALID: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];
  return VALID.includes(value as OrderStatus) ? (value as OrderStatus) : "pending";
}

/** Map a raw DB row to the OrderView shape. Money stays integer cents. */
function toOrderView(row: Record<string, unknown>): OrderView {
  const quantity = Number(row.quantity);
  return {
    id: String(row.id),
    productTitle: String(row.product_title ?? ""),
    selection: parseOrderSelection(row.selected_options),
    quantity: Number.isInteger(quantity) && quantity >= 1 ? quantity : 1,
    shipTo: parseShipTo(row.ship_to),
    fulfilment: parseFulfilment(row),
    amountCents: Number(row.amount_cents ?? 0),
    platformFeeCents: Number(row.platform_fee_cents ?? 0),
    currency: String(row.currency ?? ""),
    channel: toChannel(row.channel),
    status: toStatus(row.status),
    buyerEmail: row.buyer_email != null ? String(row.buyer_email) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

/** The column list every order read selects — one contract, one place. */
const ORDER_COLUMNS =
  "id, product_title, selected_options, quantity, ship_to, fulfilment_status, shipped_at, tracking_number, amount_cents, platform_fee_cents, currency, channel, status, buyer_email, created_at";

/**
 * The To ship rule (lib/orders/fulfilment.ts isToShip) as a query filter, so
 * the list and the count cannot disagree about what is waiting. Served by the
 * partial index orders_seller_to_ship_idx.
 */
const TO_SHIP_MATCH = { status: "paid", fulfilment_status: "unfulfilled" } as const;

/** Postgres would error on a malformed uuid, so a bad id is filtered out here
 *  rather than surfaced as "orders are unavailable". */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One order by id, scoped to the active account (RLS enforces the same at the
 * DB). Returns null when the id is malformed, the order does not exist, or it
 * belongs to someone else — all three are "nothing to show", never an error:
 * this backs a deep link (/orders?order=<id>) whose id can be stale.
 */
export async function getOrderById(id: string): Promise<OrderView | null> {
  if (!UUID.test(id)) return null;

  const account = await getActiveAccount();
  if (!account) return null;

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", account.accountId)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toOrderView(data as Record<string, unknown>);
}

/** The dashboard only ever asks about its Recent orders card's handful. */
const MAX_BATCH_IDS = 20;

/**
 * Several orders by id in one query, scoped like getOrderById. Backs the
 * overview's Recent orders card, which opens each row's detail panel in place
 * and so needs the full order up front, not just the aggregate's summary.
 * Soft-fails to [] (malformed ids are dropped): a row without its detail still
 * links to /orders?order=<id>, so a failed read here costs speed, not access.
 */
export async function getOrdersByIds(ids: string[]): Promise<OrderView[]> {
  const valid = Array.from(new Set(ids.filter((id) => UUID.test(id)))).slice(0, MAX_BATCH_IDS);
  if (valid.length === 0) return [];

  const account = await getActiveAccount();
  if (!account) return [];

  const supabase = await createClient();
  const { data, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("seller_id", account.accountId)
    .in("id", valid);

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(toOrderView);
}

/**
 * How many orders are waiting to be shipped in the ACTIVE store. Behind the
 * Orders count in the sidebar, the overview's "to ship" row and the Orders
 * page's default view, all in one request, so it is cached per request and
 * those three reads are one query.
 *
 * Soft-fails to 0: a count that blips must never block a page, and "nothing to
 * ship" is the quiet answer (the list itself still throws on a real error).
 */
export const countOrdersToShip = cache(async (): Promise<number> => {
  const account = await getActiveAccount();
  if (!account) return 0;

  const supabase = await createClient();
  const { count, error } = await (supabase as SupabaseClient)
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", account.accountId)
    .match(TO_SHIP_MATCH);
  if (error) {
    console.error("[orders] to-ship count failed", error.message);
    return 0;
  }
  return count ?? 0;
});

/**
 * Owner-scoped, paginated order list. The seller id comes from the session
 * (never from the caller); RLS enforces the same boundary at the DB.
 *
 * `view: "to-ship"` is the work queue: only orders waiting to be shipped,
 * OLDEST first whatever the sort says (the order they should go out in), and
 * no filters, which answer questions about history rather than about work.
 *
 * Returns an empty Paginated when the user is not signed in, or on any
 * Supabase error (calm zero state — the orders table may still be landing).
 */
export async function listOrders(options?: {
  view?: OrdersView;
  filters?: OrderFilters;
  sort?: OrderSort;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<OrderView>> {
  // Clamp pagination inputs.
  const pageSize = Math.min(
    Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(1, options?.page ?? 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const account = await getActiveAccount();
  if (!account) return emptyPage(page, pageSize);

  const supabase = await createClient();
  const toShip = options?.view === "to-ship";
  const filters = toShip ? undefined : options?.filters;
  const sort: OrderSort = toShip
    ? { field: "createdAt", direction: "asc" }
    : (options?.sort ?? { field: "createdAt", direction: "desc" });

  // Build the base query — select only needed columns; count for pagination.
  // Scoped to the ACTIVE account's store (own, or one you're a member of).
  let query = (supabase as SupabaseClient)
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .eq("seller_id", account.accountId);
  if (toShip) query = query.match(TO_SHIP_MATCH);

  // --- Filters ---
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.channel) {
    query = query.eq("channel", filters.channel);
  }
  if (filters?.dateFrom) {
    query = query.gte("created_at", `${filters.dateFrom}T00:00:00Z`);
  }
  if (filters?.dateTo) {
    query = query.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);
  }
  if (filters?.search && filters.search.trim() !== "") {
    const escaped = escapeIlike(filters.search.trim());
    query = query.ilike("buyer_email", `%${escaped}%`);
  }

  // --- Sort ---
  const sortColumn = sort.field === "amount" ? "amount_cents" : "created_at";
  const ascending = sort.direction === "asc";
  query = query
    .order(sortColumn, { ascending })
    // Stable tiebreak so pagination is deterministic.
    .order("id", { ascending: true });

  // --- Offset pagination ---
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    // THROW, do not soft-fail. A swallowed error here renders the calm
    // "no orders yet" empty state, which for a store with sales is a lie the
    // user cannot distinguish from reality. error.tsx gives them the truth
    // and a retry button instead.
    throw new Error(`Orders are unavailable right now: ${error.message}`);
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).map(toOrderView);
  const total = count ?? 0;

  return { rows, total, page, pageSize };
}
