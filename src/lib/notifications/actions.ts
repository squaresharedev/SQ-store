"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import {
  getNotificationPage,
  getNotificationSnapshot,
  getUnreadCount,
} from "@/lib/notifications/queries";
import { markReadSchema, notificationPageSchema } from "@/lib/validation/notifications";
import type {
  NotificationPage,
  NotificationSnapshot,
} from "@/lib/notifications/types";

/**
 * Server actions bridging the client notification UI to the DB. Every action
 * derives the user from the session server-side; the client never passes a user
 * id, and mutations are RLS-scoped to the caller's own rows (plus the column
 * grant that only allows `read` to change).
 */

/** Recent notifications + unread count for the bell on mount. */
export async function fetchNotificationSnapshot(): Promise<NotificationSnapshot | null> {
  return getNotificationSnapshot();
}

/** Authoritative unread count. Used by the client to reconcile after events. */
export async function fetchUnreadCount(): Promise<number> {
  return getUnreadCount();
}

/** A page of full history for the /notifications view / "load more". */
export async function fetchNotificationPage(
  cursor?: string | null,
): Promise<NotificationPage> {
  const parsed = notificationPageSchema.safeParse({ cursor: cursor ?? null });
  if (!parsed.success) return { notifications: [], nextCursor: null };
  return getNotificationPage({ cursor: parsed.data.cursor });
}

/** Mark one notification read. RLS + column grant ensure it's the caller's own. */
export async function markNotificationRead(
  id: string,
): Promise<{ ok: boolean; unreadCount: number }> {
  const user = await getUser();
  if (!user) return { ok: false, unreadCount: 0 };

  const parsed = markReadSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, unreadCount: await getUnreadCount() };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", parsed.data.id); // RLS also pins user_id = auth.uid()

  return { ok: !error, unreadCount: await getUnreadCount() };
}

/** Mark every unread notification read for the current user. */
export async function markAllNotificationsRead(): Promise<{
  ok: boolean;
  unreadCount: number;
}> {
  const user = await getUser();
  if (!user) return { ok: false, unreadCount: 0 };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("read", false); // RLS scopes to the caller's own rows

  return { ok: !error, unreadCount: error ? await getUnreadCount() : 0 };
}

/**
 * The current user's access token, for authenticating the browser Realtime
 * connection. The session cookie is HttpOnly (see supabase/cookie-options.ts),
 * so the browser client has no token of its own; Realtime needs one to enforce
 * RLS on the subscription (a user only ever receives their own rows).
 *
 * We validate + refresh via getUser() first, then read the (possibly refreshed)
 * token from the session. This is the user's own short-lived JWT — never the
 * service-role key — and the hook holds it only in memory.
 */
export async function getRealtimeToken(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
