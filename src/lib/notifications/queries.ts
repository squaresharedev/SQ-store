import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import {
  NO_NOTIFICATION_FILTER,
  isNotificationType,
  type NotificationFacets,
  type NotificationFilter,
} from "@/lib/notifications/filters";
import { withResolvedActions } from "@/lib/notifications/resolve-actions";
import type {
  Notification,
  NotificationPage,
  NotificationSnapshot,
} from "@/lib/notifications/types";

/**
 * Server-side reads for notifications. All are scoped to the signed-in user by
 * RLS (user_id = auth.uid()); these helpers never take a user id from the
 * caller. On any error they return a safe empty value rather than throwing into
 * a render.
 *
 * The DB types `type` as `string`; we cast rows to the narrowed `Notification`
 * union at this boundary so the rest of the app is exhaustive.
 */

const RECENT_LIMIT = 10;
export const HISTORY_PAGE_SIZE = 20;

const SELECT_COLS = "id, user_id, type, title, body, data, read, created_at";

/** Recent notifications + authoritative unread count for the bell/provider. */
export async function getNotificationSnapshot(): Promise<NotificationSnapshot | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  // RLS already scopes to user_id = auth.uid(); passing user_id explicitly (the
  // SESSION user, never a caller arg) gives the planner a direct equality qual
  // so it uses the (user_id, created_at) / (user_id, read) indexes instead of
  // relying on policy-qual push-down. Same rows either way.
  const [listResult, countResult] = await Promise.all([
    supabase
      .from("notifications")
      .select(SELECT_COLS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false),
  ]);

  if (listResult.error) {
    console.warn("[notifications] snapshot list error", listResult.error.message);
    return { userId: user.id, notifications: [], unreadCount: 0 };
  }

  return {
    userId: user.id,
    notifications: await withResolvedActions((listResult.data ?? []) as Notification[]),
    unreadCount: countResult.count ?? 0,
  };
}

/** Authoritative unread count on its own (cheap, uses the (user_id, read) index). */
export async function getUnreadCount(): Promise<number> {
  const user = await getUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);
  if (error) return 0;
  return count ?? 0;
}

/**
 * One page of full history, newest-first, keyset-paginated by created_at.
 * `cursor` is the created_at of the last row already shown (exclusive).
 * `filter` narrows it in the query itself, so every page of a filtered view
 * is full and "load more" never skips a match.
 */
export async function getNotificationPage(opts?: {
  cursor?: string | null;
  limit?: number;
  filter?: NotificationFilter;
}): Promise<NotificationPage> {
  const user = await getUser();
  if (!user) return { notifications: [], nextCursor: null };

  const limit = Math.min(Math.max(opts?.limit ?? HISTORY_PAGE_SIZE, 1), 50);
  const filter = opts?.filter ?? NO_NOTIFICATION_FILTER;
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .select(SELECT_COLS)
    .eq("user_id", user.id) // explicit session-user qual for index use (RLS-equivalent)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // fetch one extra to detect a next page
  if (filter.type) query = query.eq("type", filter.type);
  if (filter.unread) query = query.eq("read", false);
  if (opts?.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) {
    // Throw rather than render a false "no notifications yet": the page's
    // server read reaches error.tsx, and the client "Load more" path catches
    // this and shows an inline retry.
    throw new Error(`Notifications are unavailable right now: ${error.message}`);
  }

  const rows = (data ?? []) as Notification[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? page[page.length - 1]?.created_at ?? null
    : null;

  return { notifications: await withResolvedActions(page), nextCursor };
}

/**
 * How many rows the facet scan reads. The filter bar only needs to know which
 * categories a reader has anything in and how many are unread; reading two
 * narrow columns of the newest rows answers that in one request, where exact
 * per-category counts would take one request per category. A reader past this
 * many notifications still gets correct FILTERING (that is done in the query);
 * only a category whose every row is older than the window drops off the bar.
 */
const FACET_SCAN_LIMIT = 1000;

/** Which categories the reader has notifications in, and unread counts. */
export async function getNotificationFacets(): Promise<NotificationFacets> {
  const empty: NotificationFacets = { byType: {}, unread: 0 };
  const user = await getUser();
  if (!user) return empty;

  const supabase = await createClient();
  const [scan, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select("type, read")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(FACET_SCAN_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false),
  ]);
  if (scan.error) {
    // The bar degrades to its status toggle alone; the list itself is read
    // separately and still reports its own failure.
    console.warn("[notifications] facet scan error", scan.error.message);
    return { ...empty, unread: unread.count ?? 0 };
  }

  const byType: NotificationFacets["byType"] = {};
  for (const row of scan.data ?? []) {
    if (!isNotificationType(row.type)) continue;
    const facet = (byType[row.type] ??= { total: 0, unread: 0 });
    facet.total += 1;
    if (!row.read) facet.unread += 1;
  }
  return { byType, unread: unread.count ?? 0 };
}
