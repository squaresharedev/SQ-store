import { z } from "zod";
import { READ, WRITE, defineTool } from "@/lib/agent/tool";
import { fetchNotificationPage, fetchUnreadCount, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications/actions";

export const notificationTools = [
  defineTool({
    name: "list_notifications",
    title: "List notifications",
    description: "The connected person's notifications, newest first: what needs them. Pass nextCursor back for more.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({
      cursor: z.string().max(100).nullable().optional(),
      unreadOnly: z.boolean().optional(),
    }),
    handler: async ({ cursor, unreadOnly }) => {
      const page = await fetchNotificationPage(cursor, { unread: unreadOnly ?? false, type: null });
      return {
        notifications: page.notifications.map((notification) => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          read: notification.read,
          createdAt: notification.created_at,
        })),
        nextCursor: page.nextCursor,
      };
    },
  }),

  defineTool({
    name: "get_unread_count",
    title: "Count unread notifications",
    description: "How many notifications are unread.",
    scope: "store:read",
    permission: "store.read",
    annotations: READ,
    input: z.strictObject({}),
    handler: async () => ({ unread: await fetchUnreadCount() }),
  }),

  defineTool({
    name: "mark_notification_read",
    title: "Mark a notification read",
    description: "Mark one notification read. Only once the seller has actually seen it, because it clears from their bell.",
    scope: "notifications:write",
    permission: "store.read",
    annotations: { ...WRITE, idempotentHint: true },
    input: z.strictObject({ id: z.string() }),
    handler: async ({ id }) => markNotificationRead(id),
  }),

  defineTool({
    name: "mark_all_notifications_read",
    title: "Mark all notifications read",
    description: "Mark every notification read. Only when the seller asks.",
    scope: "notifications:write",
    permission: "store.read",
    annotations: { ...WRITE, idempotentHint: true },
    input: z.strictObject({}),
    handler: async () => markAllNotificationsRead(),
  }),
];
