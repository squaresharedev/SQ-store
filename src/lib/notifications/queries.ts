import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
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
  const [listResult, countResult] = await Promise.all([
    supabase
      .from("notifications")
      .select(SELECT_COLS)
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("read", false),
  ]);

  if (listResult.error) {
    console.warn("[notifications] snapshot list error", listResult.error.message);
    return { userId: user.id, notifications: [], unreadCount: 0 };
  }

  return {
    userId: user.id,
    notifications: (listResult.data ?? []) as Notification[],
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
    .eq("read", false);
  if (error) return 0;
  return count ?? 0;
}

/**
 * One page of full history, newest-first, keyset-paginated by created_at.
 * `cursor` is the created_at of the last row already shown (exclusive).
 */
export async function getNotificationPage(opts?: {
  cursor?: string | null;
  limit?: number;
}): Promise<NotificationPage> {
  const user = await getUser();
  if (!user) return { notifications: [], nextCursor: null };

  const limit = Math.min(Math.max(opts?.limit ?? HISTORY_PAGE_SIZE, 1), 50);
  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .select(SELECT_COLS)
    .order("created_at", { ascending: false })
    .limit(limit + 1); // fetch one extra to detect a next page
  if (opts?.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) {
    console.warn("[notifications] page error", error.message);
    return { notifications: [], nextCursor: null };
  }

  const rows = (data ?? []) as Notification[];
  const hasMore = rows.length > limit;
  const notifications = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? notifications[notifications.length - 1]?.created_at ?? null
    : null;

  return { notifications, nextCursor };
}
