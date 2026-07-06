import type { Tables } from "@/types";

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
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A notification row as the app consumes it (type narrowed to the enum). */
export type Notification = Omit<Tables<"notifications">, "type"> & {
  type: NotificationType;
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
