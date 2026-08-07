/**
 * UNIVERSAL SEARCH — the shared contract between the local registry, the
 * /api/search route handler, and the palette UI.
 *
 * Pure types. Safe to import from a Client Component, a Server Component, or
 * the route handler.
 */

/** Where a result came from. The first three are LOCAL (matched in the browser,
 *  no network); the rest are REMOTE (one query each in /api/search). */
export type SearchResultType =
  | "page"
  | "action"
  | "settings"
  | "product"
  | "order"
  | "storefront"
  | "team"
  | "notification";

/** Local types never touch the network, so they survive every failure mode. */
export const LOCAL_TYPES = ["page", "action", "settings"] as const;

/** Remote types, in the order their groups are rendered. */
export const REMOTE_TYPES = [
  "product",
  "order",
  "storefront",
  "team",
  "notification",
] as const;

export type RemoteSearchType = (typeof REMOTE_TYPES)[number];

export function isRemoteSearchType(value: string): value is RemoteSearchType {
  return (REMOTE_TYPES as readonly string[]).includes(value);
}

export type SearchResult = {
  /** Unique across the WHOLE result set — it becomes the option's DOM id, and
   *  aria-activedescendant depends on it being unambiguous. */
  id: string;
  type: SearchResultType;
  title: string;
  /** Second line: a status, an email, a breadcrumb like "Settings › Account". */
  subtitle?: string;
  /** Navigation target. Every result has one today; the field stays optional so
   *  a future pure action (e.g. "Toggle theme") needs no type change. */
  href?: string;
  /** Short chip at the right of the row: "Draft", "Refunded", "Viewer". */
  badge?: string;
};

export type SearchGroup = {
  label: string;
  type: SearchResultType;
  results: SearchResult[];
};

/** Body of a 200 from GET /api/search. Empty `groups` means "nothing matched",
 *  which the client must be able to tell apart from "the request failed" —
 *  hence a 200 with an empty array rather than an error. */
export type SearchApiResponse = {
  query: string;
  groups: SearchGroup[];
};

/** Below this the palette never calls the network: a 1-character query matches
 *  most of the catalogue and is never what someone meant. The local registry
 *  still answers from the first keystroke. */
export const MIN_REMOTE_QUERY_LENGTH = 2;

/** Server-side cap, mirrored by the validation schema. */
export const MAX_QUERY_LENGTH = 100;

// ── The snapshot ─────────────────────────────────────────────────────────
// A compact index of the ACTIVE account's entity names, prefetched once per
// session and matched client-side. It exists so content search answers
// instantly and keeps answering when the live endpoint is slow, cold, or
// unreachable — names only, never money amounts or bodies, so the payload
// stays a few tens of KB.

export type SnapshotProduct = { id: string; title: string; status: string };
export type SnapshotStorefront = { id: string; name: string };
export type SnapshotTeamMember = {
  id: string;
  /** The member's handle (the roster's public name since the username work). */
  username: string | null;
  invited_email: string;
  role: string;
  status: string;
};
export type SnapshotOrder = {
  id: string;
  product_title: string;
  buyer_email: string | null;
  status: string;
};
export type SnapshotNotification = { id: string; title: string; read: boolean };

export type SearchSnapshot = {
  /** Newest first. */
  products: SnapshotProduct[];
  storefronts: SnapshotStorefront[];
  team: SnapshotTeamMember[];
  /** Newest first. */
  orders: SnapshotOrder[];
  /** Newest first. */
  notifications: SnapshotNotification[];
};

/** Body of a 200 from GET /api/search/snapshot. */
export type SearchSnapshotResponse = { snapshot: SearchSnapshot };

export const EMPTY_SNAPSHOT: SearchSnapshot = {
  products: [],
  storefronts: [],
  team: [],
  orders: [],
  notifications: [],
};
