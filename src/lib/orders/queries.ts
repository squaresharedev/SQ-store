import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { escapeIlike } from "@/lib/supabase/ilike";
import { getActiveAccount } from "@/lib/team/account-context";
import { parseOrderSelection } from "@/lib/orders/selection";
import type {
  OrderView,
  OrderFilters,
  OrderSort,
  OrderChannel,
  OrderStatus,
  Paginated,
} from "@/types/order-view";

// READ-ONLY paginated orders list. Server Components / Route Handlers only
// (cookies() is Node-only — never middleware).
//
// TODO(notifications:order): when an order lands (the future checkout / Stripe
// webhook that WRITES orders, not this read path), notify the seller. The
// producer belongs in that server-side writer, which knows the seller id:
//   await createNotification({ userId: sellerId, type: "order",
//     title: `New order: ${productTitle}`, data: { href: "/orders" } });
// (from "@/lib/notifications/create"). Not wired: orders are seed-only for now.
//
// TODO(checkout) / NOT MERCHANT OF RECORD: that same future writer must create
// the Stripe charge ON the seller's connected account (Direct Charge, or
// Destination Charge with `on_behalf_of`) and record OUR cut in
// platform_fee_cents as the resulting `application_fee_amount` — never route
// the full amount through a Squareshare-owned account first. See
// lib/payments/types.ts and components/product-page/ProductCta.tsx for the
// same guardrail on the other two sides of this seam.
//
// The generated Database types don't include `orders` (owned by the concurrent
// seed work), so reads go through an untyped client cast against the agreed
// column contract below. Column contract (do not rename):
//   id, seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, buyer_email, product_title,
//   product_price_cents, selected_options, created_at
//
// TODO(checkout): `selected_options` is the version the buyer bought, snapshot
// label/value pairs (see types/order-view.ts). The future writer must fill it
// from the buyer's own choice at the moment of sale, never by looking the
// product's options up afterwards: an order records what WAS sold, and the
// product's options are free to change after it.

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
  return {
    id: String(row.id),
    productTitle: String(row.product_title ?? ""),
    selection: parseOrderSelection(row.selected_options),
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
  "id, product_title, selected_options, amount_cents, platform_fee_cents, currency, channel, status, buyer_email, created_at";

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

/**
 * Owner-scoped, paginated order list. The seller id comes from the session
 * (never from the caller); RLS enforces the same boundary at the DB.
 *
 * Returns an empty Paginated when the user is not signed in, or on any
 * Supabase error (calm zero state — the orders table may still be landing).
 */
export async function listOrders(options?: {
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
  const filters = options?.filters;
  const sort = options?.sort ?? { field: "createdAt", direction: "desc" };

  // Build the base query — select only needed columns; count for pagination.
  // Scoped to the ACTIVE account's store (own, or one you're a member of).
  let query = (supabase as SupabaseClient)
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .eq("seller_id", account.accountId);

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
