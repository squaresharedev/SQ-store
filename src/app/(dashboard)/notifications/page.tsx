import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationsPageClient } from "@/components/notifications/NotificationsPageClient";
import { notificationFilterQuery, parseNotificationFilter } from "@/lib/notifications/filters";
import { getNotificationFacets, getNotificationPage } from "@/lib/notifications/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications.metadata.notifications");
  return { title: t("title") };
}

type SearchParams = { [key: string]: string | string[] | undefined };

/**
 * Full notification history. Auth is enforced by the (dashboard) layout; the
 * first page is fetched server-side (RLS-scoped to the user) and handed to the
 * client for pagination + mark-read. Empty/loading states live in the client.
 *
 * `?type=<category>&status=unread` narrows it. Parsed against a whitelist
 * (lib/notifications/filters.ts) and applied in the query, so a filtered view
 * pages through every match, not just the matches on the first page.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const filter = parseNotificationFilter(await searchParams);
  const [{ notifications, nextCursor }, facets] = await Promise.all([
    getNotificationPage({ filter }),
    getNotificationFacets(),
  ]);

  return (
    <NotificationsPageClient
      // A new filter is a new list: remount so it starts from its own first
      // page instead of appending to the previous view's rows.
      key={notificationFilterQuery(filter)}
      initial={notifications}
      initialCursor={nextCursor}
      filter={filter}
      facets={facets}
    />
  );
}
