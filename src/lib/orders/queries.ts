import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
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
// The generated Database types don't include `orders` (owned by the concurrent
// seed work), so reads go through an untyped client cast against the agreed
// column contract below. Column contract (do not rename):
//   id, seller_id, product_id, storefront_id, channel, status, amount_cents,
//   platform_fee_cents, currency, buyer_email, product_title,
//   product_price_cents, created_at

export const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Return an empty paginated envelope with the given page/pageSize echoed back. */
function emptyPage(page: number, pageSize: number): Paginated<OrderView> {
  return { rows: [], total: 0, page, pageSize };
}

/** Escape ilike wildcard characters (%, _, \) in a user-supplied search term. */
function escapeIlike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
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
    amountCents: Number(row.amount_cents ?? 0),
    platformFeeCents: Number(row.platform_fee_cents ?? 0),
    currency: String(row.currency ?? ""),
    channel: toChannel(row.channel),
    status: toStatus(row.status),
    buyerEmail: row.buyer_email != null ? String(row.buyer_email) : null,
    createdAt: String(row.created_at ?? ""),
  };
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
    .select(
      "id, product_title, amount_cents, platform_fee_cents, currency, channel, status, buyer_email, created_at",
      { count: "exact" },
    )
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
    // Table not created yet, or transient failure: render the calm zero state.
    console.warn("[orders] listOrders read unavailable:", error.message);
    return emptyPage(page, pageSize);
  }

  const rows = ((data ?? []) as Record<string, unknown>[]).map(toOrderView);
  const total = count ?? 0;

  return { rows, total, page, pageSize };
}
