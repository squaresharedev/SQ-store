// Shared view contract for the /orders page. Every orders module (queries,
// table, toolbar, detail, badges) speaks these types — no module invents its
// own row shape. Types only: safe to import from client and server code.
//
// Money is ALWAYS integer cents; formatting happens in one place
// (lib/format/money.ts). Dates are ISO strings from the DB.

/** Where the sale happened. Mirrors the orders.channel CHECK constraint. */
export type OrderChannel = "embed" | "marketplace";

/** Order lifecycle. Mirrors the orders.status CHECK constraint. */
export type OrderStatus = "paid" | "refunded" | "disputed" | "pending";

/** One order as the seller sees it. Snapshot fields survive product edits. */
export type OrderView = {
  id: string;
  productTitle: string;
  amountCents: number;
  platformFeeCents: number;
  /** "EUR" | "USD" today; keep string so new currencies are additive. */
  currency: string;
  channel: OrderChannel;
  status: OrderStatus;
  buyerEmail: string | null;
  /** ISO timestamp (orders.created_at). */
  createdAt: string;
};

/** Toolbar output = query input. All fields optional; absent = no filter. */
export type OrderFilters = {
  status?: OrderStatus;
  channel?: OrderChannel;
  /** Inclusive ISO date (YYYY-MM-DD) lower bound on createdAt. */
  dateFrom?: string;
  /** Inclusive ISO date (YYYY-MM-DD) upper bound on createdAt. */
  dateTo?: string;
  /** Case-insensitive substring match on buyerEmail. */
  search?: string;
};

export type OrderSortField = "createdAt" | "amount";

export type OrderSort = {
  field: OrderSortField;
  direction: "asc" | "desc";
};

/** Offset pagination envelope. `page` is 1-based. */
export type Paginated<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};
