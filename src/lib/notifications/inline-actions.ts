import { z } from "zod";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { storedNotificationMessage } from "@/lib/notifications/message";
import type { NotificationType } from "@/lib/notifications/types";

/**
 * WHAT A NOTIFICATION LETS YOU DO, at two levels.
 *
 *  1. Every row goes somewhere: clicking it opens the page where the thing it
 *     is about can be seen or done ({@link notificationDestination}).
 *  2. Some rows can be acted on in place, without leaving the list: a team
 *     invite has an Accept button right on it.
 *
 * An inline action is stored by its producer in `data.action` as a kind plus
 * the ids it needs. The reader never sends those ids back: the client names
 * the NOTIFICATION, and the server re-reads the row (its own, RLS-scoped),
 * works out what the action is, and runs it through the same code path the
 * page it replaces would use. So a tampered client can at most ask for an
 * action on a notification it already owns.
 *
 * Isomorphic, pure: parsed on the server (to resolve and run actions) and on
 * the client (for rows that arrive over Realtime).
 */

export const NOTIFICATION_ACTION_KINDS = ["team.acceptInvite"] as const;

export type NotificationActionKind = (typeof NOTIFICATION_ACTION_KINDS)[number];

/** What a producer writes into `data.action`. */
export type StoredNotificationAction = {
  kind: "team.acceptInvite";
  inviteId: string;
  /** The store being joined, so a finished accept can be recognised later. */
  accountOwnerId: string;
};

/**
 * Where an inline action stands for this reader right now. Resolved against
 * live state, never trusted from the row: an invite accepted from Settings, or
 * revoked by its sender, must not keep offering an Accept that can only fail.
 *
 *  - `pending`: can be done now.
 *  - `done`:    already done (here, elsewhere, or on another device).
 *  - `expired`: no longer possible (revoked, or the store is gone).
 */
export type NotificationActionStatus = "pending" | "done" | "expired";

/** What the reader's UI is given: no ids, just what to draw. */
export type NotificationActionView = {
  kind: NotificationActionKind;
  status: NotificationActionStatus;
};

const storedActionSchema = z.object({
  action: z.strictObject({
    kind: z.literal("team.acceptInvite"),
    inviteId: z.uuid(),
    accountOwnerId: z.uuid(),
  }),
});

/** The inline action stored on a notification, or null when there is none. */
export function storedNotificationAction(data: unknown): StoredNotificationAction | null {
  const parsed = storedActionSchema.safeParse(data);
  return parsed.success ? parsed.data.action : null;
}

/**
 * A team invite notification written before invites carried `data.action`:
 * what it says about the invite (the inviter's store name and the role), so
 * the server can find the matching pending invite. Null for anything else.
 */
export function legacyInviteDetails(
  type: NotificationType,
  data: unknown,
): { store: string | null; role: string | null } | null {
  if (type !== "team") return null;
  const message = storedNotificationMessage(data);
  if (message?.title.key !== "Notifications.messages.teamInvite.title") return null;
  const values = message.body?.values ?? {};
  const store = typeof values.store === "string" ? values.store : null;
  const role = typeof values.role === "string" ? values.role : null;
  return { store, role };
}

/**
 * Where a row without a link of its own goes, by category. Only categories
 * with one obvious home: a "system" or "policy" notice without a link has no
 * page to open, so it stays a plain row that marks itself read.
 */
const TYPE_DESTINATION: Partial<Record<NotificationType, string>> = {
  team: "/settings/team",
  security: "/settings/security",
  order: "/orders",
  payment: "/payments",
  stock: "/products",
};

/**
 * Where clicking a notification takes the reader: its own `data.href` when
 * that is a safe in-app path, else its category's home, else nowhere.
 *
 * `data` is read back from the database, so the href is untrusted: only a
 * same-origin path survives (never an external URL or a `javascript:`), with
 * the same guard the auth redirect uses. A rejected href does NOT fall back to
 * the category page either: a payload that tried to leave the app is not one
 * to guess a destination for.
 */
export function notificationDestination(type: NotificationType, data: unknown): string | null {
  if (data && typeof data === "object" && !Array.isArray(data) && "href" in data) {
    const safe = safeInternalPath((data as Record<string, unknown>).href, "");
    return safe === "" ? null : safe;
  }
  return TYPE_DESTINATION[type] ?? null;
}
