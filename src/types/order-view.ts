// Shared view contract for the /orders page. Every orders module (queries,
// table, toolbar, detail, badges) speaks these types — no module invents its
// own row shape. Types plus the bounds that belong to them, and nothing else:
// no imports, no runtime dependencies, safe from client and server code alike.
//
// Money is ALWAYS integer cents; formatting happens in one place
// (lib/format/money.ts). Dates are ISO strings from the DB.

/** Where the sale happened. Mirrors the orders.channel CHECK constraint. */
export type OrderChannel = "embed" | "marketplace" | "direct";

/** Order lifecycle. Mirrors the orders.status CHECK constraint. */
export type OrderStatus = "paid" | "refunded" | "disputed" | "pending";

/**
 * Whether the parcel has gone. Mirrors the orders.fulfilment_status CHECK.
 * Separate from OrderStatus, which is about the MONEY: a paid order can still
 * be waiting to ship, and a shipped one can later be refunded.
 */
export type FulfilmentStatus = "unfulfilled" | "shipped" | "not_required";

/**
 * WHERE THE PARCEL GOES, snapshotted at checkout (orders.ship_to).
 *
 * A snapshot for the same reason `productTitle` is one: a buyer who moves after
 * ordering must not move a parcel that has already been addressed. Fields are
 * the ones every carrier form asks for, in the buyer's own words; `country` is
 * the ISO 3166-1 alpha-2 code, printed in the reader's language.
 */
export type ShipTo = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
  /** For the courier, when the buyer gave one. */
  phone?: string;
};

/** Per-field caps for the stored address. Generous for any real address, and
 *  small enough that the whole object stays under the column's 2 KB CHECK
 *  even written entirely in four-byte characters. */
export const SHIP_TO_MAX = {
  name: 100,
  line1: 100,
  line2: 100,
  city: 60,
  region: 60,
  postalCode: 16,
  phone: 24,
} as const;

/** A carrier tracking number: the orders.tracking_number CHECK's bounds. */
export const TRACKING_NUMBER_MIN = 4;
export const TRACKING_NUMBER_MAX = 40;

/** Whether an order's parcel has gone, and how the buyer can follow it. */
export type OrderFulfilment = {
  status: FulfilmentStatus;
  /** ISO timestamp, set exactly when status is "shipped". */
  shippedAt: string | null;
  trackingNumber: string | null;
};

/**
 * Which list the Orders page shows. "to-ship" is the work queue (paid, not
 * sent yet, oldest first); "all" is the full history with its filters.
 */
export type OrdersView = "to-ship" | "all";
export const ORDERS_VIEWS: readonly OrdersView[] = ["to-ship", "all"];

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
  /** Units sold, 1 or more. */
  quantity: number;
  /** Null when nothing ships (a download), or the order predates addresses. */
  shipTo: ShipTo | null;
  fulfilment: OrderFulfilment;
  amountCents: number;
  platformFeeCents: number;
  /** The fee's rate in basis points (300 = 3%), as snapshotted at sale time;
   *  null on orders written before plans existed. */
  platformFeeBps: number | null;
  /** "EUR" | "USD" today; keep string so new currencies are additive. */
  currency: string;
  channel: OrderChannel;
  status: OrderStatus;
  buyerEmail: string | null;
  /** ISO timestamp (orders.created_at). */
  createdAt: string;
  /** The buyer's gift note for the parcel. Null when none was written. Physical
   *  orders only; the writer drops it for a download. */
  giftMessage: string | null;
  /** ISO timestamp: when the buyer used the EU withdrawal function on their
   *  order page (CRD art. 11a). Null when no withdrawal was requested. */
  withdrawalRequestedAt: string | null;
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
