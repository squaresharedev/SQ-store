import { orderResultHref } from "@/lib/search/hrefs";
import { rankEntries } from "@/lib/search/rank";
import type {
  SearchGroup,
  SearchResult,
  SearchSnapshot,
} from "@/lib/search/types";

/**
 * Turn the cached snapshot into palette result groups.
 *
 * Pure functions, no React and no fetching: the overlay calls these inside the
 * same render as the keystroke, exactly like the local registry. Group labels
 * and result shapes MATCH the live /api/search groups on purpose — when the
 * live response lands it replaces these per type, and the swap must be
 * invisible apart from fresher rows.
 *
 * Registry-shaped things (pages, settings, actions) do NOT belong here; this
 * module only knows entity data.
 */

/** Per-group caps mirroring the live route's (see /api/search LIMITS). */
const LIMITS = {
  product: 5,
  order: 5,
  storefront: 4,
  team: 4,
  notification: 3,
} as const;

/** Same ids as the live results (`product:${id}`…), so a row keeps its DOM id
 *  — and therefore aria-activedescendant — across the snapshot→live swap. */
function toResults(snapshot: SearchSnapshot): SearchResult[] {
  return [
    ...snapshot.products.map(
      (row): SearchResult => ({
        id: `product:${row.id}`,
        type: "product",
        title: row.title,
        href: `/products/${row.id}/edit`,
        badge: row.status === "active" ? undefined : "Draft",
      }),
    ),
    ...snapshot.storefronts.map(
      (row): SearchResult => ({
        id: `storefront:${row.id}`,
        type: "storefront",
        title: row.name,
        subtitle: "Open in the designer",
        href: `/storefront/${row.id}`,
      }),
    ),
    ...snapshot.team.map(
      (row): SearchResult => ({
        id: `team:${row.id}`,
        type: "team",
        title: row.username || row.invited_email,
        subtitle: row.username ? row.invited_email : "Invited",
        href: "/settings/team",
        badge: row.status === "active" ? row.role : row.status,
      }),
    ),
    ...snapshot.orders.map(
      (row): SearchResult => ({
        id: `order:${row.id}`,
        type: "order",
        title: row.product_title || "Order",
        subtitle: row.buyer_email ?? undefined,
        href: orderResultHref(row.id, row.buyer_email),
        badge: row.status || undefined,
      }),
    ),
    ...snapshot.notifications.map(
      (row): SearchResult => ({
        id: `notification:${row.id}`,
        type: "notification",
        title: row.title,
        href: "/notifications",
        badge: row.read ? undefined : "Unread",
      }),
    ),
  ];
}

const GROUPS: { type: SearchResult["type"]; label: string }[] = [
  { type: "product", label: "Products" },
  { type: "order", label: "Orders" },
  { type: "storefront", label: "Storefronts" },
  { type: "team", label: "Team" },
  { type: "notification", label: "Notifications" },
];

/** Which fields a query matches per entity. Title plus the same second column
 *  the live search matches (buyer email for orders, email for team). */
function termsFor(result: SearchResult): string[] {
  return result.subtitle ? [result.title, result.subtitle] : [result.title];
}

/**
 * Match the snapshot against a query, grouped and capped like the live
 * response. Empty when the query is blank or nothing matches.
 */
export function buildSnapshotGroups(
  snapshot: SearchSnapshot | null,
  query: string,
): SearchGroup[] {
  const term = query.trim();
  if (!snapshot || !term) return [];

  const all = toResults(snapshot);
  return GROUPS.map(({ type, label }) => ({
    type,
    label,
    results: rankEntries(
      all.filter((result) => result.type === type),
      term,
      termsFor,
      LIMITS[type as keyof typeof LIMITS],
    ),
  })).filter((group) => group.results.length > 0);
}

/**
 * The "Recent" rail for the EMPTY palette: the newest few products and
 * storefronts, i.e. what this account most plausibly wants to jump back into.
 * Null when the snapshot has nothing to offer, so the empty state falls back
 * to the registry suggestions alone.
 */
export function buildRecentGroup(
  snapshot: SearchSnapshot | null,
): SearchGroup | null {
  if (!snapshot) return null;
  // Snapshot arrays are newest-first by contract (see the route handler).
  // Three rows total: the resting card shows Recent + Actions + Settings and
  // must fit its cap without scrolling.
  const results: SearchResult[] = toResults({
    ...snapshot,
    products: snapshot.products.slice(0, 2),
    storefronts: snapshot.storefronts.slice(0, 1),
    team: [],
    orders: [],
    notifications: [],
  });
  if (results.length === 0) return null;
  // group.type is a key/order placeholder — each RESULT carries its own type,
  // which is what drives icons and activation.
  return { type: "product", label: "Recent", results };
}
