// Shared view contract for the /orders page. Every orders module (queries,
// table, toolbar, detail, badges) speaks these types — no module invents its
// own row shape. Types plus the bounds that belong to them, and nothing else:
// no imports, no runtime dependencies, safe from client and server code alike.
//
// Money is ALWAYS integer cents; formatting happens in one place
// (lib/format/money.ts). Dates are ISO strings from the DB.

/** Where the sale happened. Mirrors the orders.channel CHECK constraint. */
export type OrderChannel = "embed" | "marketplace";

/** Order lifecycle. Mirrors the orders.status CHECK constraint. */
export type OrderStatus = "paid" | "refunded" | "disputed" | "pending";

/**
 * WHICH VERSION WAS BOUGHT, in words.
 *
 * `{ label: "Size", value: "Six seater" }`: the group's name and the chosen
 * option's name, snapshotted at the sale exactly as `productTitle` and
 * `productPriceCents` are. NOT option ids, and that is the whole point. A
 * seller who renames "Six seater" or deletes it must not silently change what
 * a past order says they sold, and an id that no longer resolves is a parcel
 * nobody can pack. The words are what goes in the box.
 *
 * Label/value rather than a fixed shape, so the same field carries whatever a
 * buyer chooses or types later (an engraving, a gift note) without another
 * migration or another column to teach every reader about.
 */
export type OrderSelection = { label: string; value: string };

/** Bounds for the stored snapshot. A product has at most OPTION_GROUPS_MAX (4)
 *  axes; the rest of the allowance is room for what a buyer fills in later. */
export const ORDER_SELECTION_MAX = 8;
export const ORDER_SELECTION_LABEL_MAX = 40;
export const ORDER_SELECTION_VALUE_MAX = 120;

/** One order as the seller sees it. Snapshot fields survive product edits. */
export type OrderView = {
  id: string;
  productTitle: string;
  /** What the buyer picked, in the seller's own words. Empty for a product
   *  sold in one version, which is most of them. */
  selection: OrderSelection[];
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

/**
 * Longest search term the orders list accepts.
 *
 * 254 is the RFC 5321 maximum for an email address, and `search` matches
 * buyer_email — so this is "as long as a value in that column can be", not an
 * arbitrary round number. It lives beside the filter contract because both
 * ends need it: the toolbar input caps typing here, and the page caps the `?q=`
 * URL param, which is the end nobody types into.
 */
export const ORDERS_SEARCH_MAX_LENGTH = 254;

/** Toolbar output = query input. All fields optional; absent = no filter. */
export type OrderFilters = {
  status?: OrderStatus;
  channel?: OrderChannel;
  /** Inclusive ISO date (YYYY-MM-DD) lower bound on createdAt. */
  dateFrom?: string;
  /** Inclusive ISO date (YYYY-MM-DD) upper bound on createdAt. */
  dateTo?: string;
  /** Case-insensitive substring match on buyerEmail, capped at
   *  ORDERS_SEARCH_MAX_LENGTH by whoever populates it. */
  search?: string;
};

export type OrderSortField = "createdAt" | "amount";

export type OrderSort = {
  field: OrderSortField;
  direction: "asc" | "desc";
};

/** Offset pagination envelope. `page` is 1-based. Defined in types/pagination
 *  (products paginate too); re-exported here so existing imports keep working. */
export type { Paginated } from "./pagination";
