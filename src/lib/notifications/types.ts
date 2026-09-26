import type { Tables } from "@/types";
import type { NotificationActionView } from "@/lib/notifications/inline-actions";

/**
 * Shared notification types. The DB row (`Tables<"notifications">`) types `type`
 * as `string`; the app narrows it to `NotificationType` at the read boundary
 * (queries.ts casts) so components get an exhaustive union.
 */

export const NOTIFICATION_TYPES = [
  "team",
  "payment",
  "stock",
  "order",
  "system",
  /** Credential-level events: password changed, reset requested, email moved.
   *  Separate from "system" so it can be styled to actually catch the eye,
   *  which is the entire point of telling someone their password changed. */
  "security",
  /** A moderation decision about this seller's own content: a product or
   *  storefront removed, or restored. Its own type rather than "system"
   *  because it is the one notification a seller is ENTITLED to receive (EU
   *  Digital Services Act, Art. 17 requires a statement of reasons), so it has
   *  to be findable by type later, not buried in a general feed. */
  "policy",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * A notification row as the app consumes it (type narrowed to the enum), plus
 * the inline action it offers, if any. `action` is not a column: the server
 * resolves it against live state when it reads the row (see
 * resolve-actions.ts), and a row that arrives over Realtime derives it from
 * `data`. Absent or null means "nothing to do in place".
 */
export type Notification = Omit<Tables<"notifications">, "type"> & {
  type: NotificationType;
  action?: NotificationActionView | null;
};

/** Recent list + authoritative unread count for the bell/provider. */
export type NotificationSnapshot = {
  /** The current user's id — used to scope the realtime subscription filter. */
  userId: string;
  notifications: Notification[];
  unreadCount: number;
};

/** One page of the full history. */
export type NotificationPage = {
  notifications: Notification[];
  /** Cursor (created_at of the last row) for the next page, or null if done. */
  nextCursor: string | null;
};
