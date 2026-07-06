import type { Metadata } from "next";
import { NotificationsPageClient } from "@/components/notifications/NotificationsPageClient";
import { getNotificationPage } from "@/lib/notifications/queries";

export const metadata: Metadata = {
  title: "Notifications",
};

/**
 * Full notification history. Auth is enforced by the (dashboard) layout; the
 * first page is fetched server-side (RLS-scoped to the user) and handed to the
 * client for pagination + mark-read. Empty/loading states live in the client.
 */
export default async function NotificationsPage() {
  const { notifications, nextCursor } = await getNotificationPage();

  return (
    <NotificationsPageClient
      initial={notifications}
      initialCursor={nextCursor}
    />
  );
}
