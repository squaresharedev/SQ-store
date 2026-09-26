"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import {
  getNotificationPage,
  getNotificationSnapshot,
  getUnreadCount,
} from "@/lib/notifications/queries";
import { isMemberOf, resolveActionTarget } from "@/lib/notifications/resolve-actions";
import { acceptTeamInvite } from "@/lib/team/accept";
import {
  markReadSchema,
  notificationActionSchema,
  notificationPageSchema,
} from "@/lib/validation/notifications";
import { actionError, sessionExpired, type ActionError } from "@/lib/errors";
import { msg, type MessageRef } from "@/i18n/types";
import type { NotificationFilter } from "@/lib/notifications/filters";
import type { NotificationActionStatus } from "@/lib/notifications/inline-actions";
import type {
  Notification,
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
  filter?: NotificationFilter,
): Promise<NotificationPage> {
  const parsed = notificationPageSchema.safeParse({
    cursor: cursor ?? null,
    type: filter?.type ?? null,
    unread: filter?.unread ?? false,
  });
  if (!parsed.success) return { notifications: [], nextCursor: null };
  const { type, unread } = parsed.data;
  return getNotificationPage({ cursor: parsed.data.cursor, filter: { type, unread } });
}

export type NotificationActionResult =
  | {
      ok: true;
      /** The store just joined, for the "Open store" follow-up. */
      accountOwnerId: string | null;
      message: MessageRef;
    }
  | {
      ok: false;
      /** Where the action stands now: `pending` means it is worth retrying. */
      status: NotificationActionStatus;
      error: ActionError;
    };

const ACTION_UNAVAILABLE: ActionError = actionError(
  "not_found",
  msg("Notifications.actions.unavailable"),
);

/**
 * Run the inline action on one of the caller's notifications (today: accept
 * the team invite it announces).
 *
 * The client names only the NOTIFICATION. The row is re-read as the caller's
 * own, the action is worked out from it against live state
 * (resolveActionTarget), and the work is done by the same function the Team &
 * access page uses (acceptTeamInvite), with all of its checks. Nothing the
 * client sends can choose which invite is accepted.
 *
 * Idempotent from the reader's side: a second click, a stale row on another
 * tab, or an invite already accepted from Settings all come back as done
 * rather than as an error, because the reader's goal has been met.
 */
export async function runNotificationAction(
  id: string,
): Promise<NotificationActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, status: "pending", error: sessionExpired() };

  const parsed = notificationActionSchema.safeParse({ id });
  if (!parsed.success) return { ok: false, status: "expired", error: ACTION_UNAVAILABLE };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("notifications")
    .select("id, type, data")
    .eq("id", parsed.data.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !row) return { ok: false, status: "expired", error: ACTION_UNAVAILABLE };

  const { target, accountOwnerId } = await resolveActionTarget(row as Pick<Notification, "type" | "data">);

  if (!target) {
    // Nothing left to accept. If that is because the reader already joined,
    // say so; otherwise the invite is gone (revoked, or never matched).
    if (accountOwnerId && (await isMemberOf(accountOwnerId))) {
      await markRowRead(parsed.data.id, user.id);
      return { ok: true, accountOwnerId, message: msg("Settings.team.success.inviteAccepted") };
    }
    return { ok: false, status: "expired", error: ACTION_UNAVAILABLE };
  }

  const result = await acceptTeamInvite(target.inviteId);
  if (!result.ok) {
    // Lost a race with another tab or device that accepted the same invite.
    if (result.accountOwnerId && (await isMemberOf(result.accountOwnerId))) {
      await markRowRead(parsed.data.id, user.id);
      return {
        ok: true,
        accountOwnerId: result.accountOwnerId,
        message: msg("Settings.team.success.inviteAccepted"),
      };
    }
    const retryable = result.error.code === "server_error" || result.error.code === "session_expired";
    return { ok: false, status: retryable ? "pending" : "expired", error: result.error };
  }

  // Acting on a notification is reading it.
  await markRowRead(parsed.data.id, user.id);
  return {
    ok: true,
    accountOwnerId: result.accountOwnerId,
    message: msg("Settings.team.success.inviteAccepted"),
  };
}

async function markRowRead(id: string, userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("notifications").update({ read: true }).eq("id", id).eq("user_id", userId);
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
    .eq("id", parsed.data.id)
    // Explicit owner predicate alongside RLS. The read path already does this;
    // without it the write relied on RLS as a single point of failure, so any
    // future policy slip would let a guessed UUID mark someone else's row read.
    .eq("user_id", user.id);

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
    .eq("read", false)
    // As above: explicit owner predicate rather than trusting RLS alone. Also
    // keeps this off a full-table update path if a policy is ever loosened.
    .eq("user_id", user.id);

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
