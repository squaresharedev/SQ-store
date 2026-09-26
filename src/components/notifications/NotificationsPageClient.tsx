"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { errorTextClass, helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { Spinner } from "@/components/ui/spinner";
import { NotificationFilters } from "@/components/notifications/NotificationFilters";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { useOptionalNotificationsContext } from "@/components/notifications/NotificationsProvider";
import {
  fetchNotificationPage,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import {
  NO_NOTIFICATION_FILTER,
  isFiltered,
  notificationFilterQuery,
  type NotificationFacets,
  type NotificationFilter,
} from "@/lib/notifications/filters";
import type { Notification } from "@/lib/notifications/types";

/**
 * Full notification history. Self-contained: seeded with a server-rendered
 * first page, then paginates + mutates through server actions with optimistic
 * updates. The realtime bell reflects the same DB changes independently (via
 * its subscription), so the two stay consistent without shared client state.
 *
 * The filter lives in the URL and is applied by the server. Changing it is a
 * navigation; the route keys this component by the filter, so each view
 * starts from its own first page rather than from the last one's rows.
 */
export function NotificationsPageClient({
  initial,
  initialCursor,
  filter,
  facets,
}: {
  initial: Notification[];
  initialCursor: string | null;
  filter: NotificationFilter;
  facets: NotificationFacets;
}) {
  const t = useTranslations("Notifications.page");
  const tFilters = useTranslations("Notifications.filters");
  const tCommon = useTranslations("Common.actions");
  const router = useRouter();
  const pathname = usePathname();
  const shared = useOptionalNotificationsContext();
  const [items, setItems] = React.useState<Notification[]>(initial);
  const [cursor, setCursor] = React.useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [filtering, startFiltering] = React.useTransition();
  // Unread rows read on this page since it loaded, so "Mark all read" knows
  // when nothing is left, including rows outside the current filter.
  const [readHere, setReadHere] = React.useState(0);
  const [allRead, setAllRead] = React.useState(false);

  const hasUnread =
    !allRead && (items.some((n) => !n.read) || facets.unread - readHere > 0);
  const filtered = isFiltered(filter);

  function applyFilter(next: NotificationFilter) {
    startFiltering(() => {
      router.replace(`${pathname}${notificationFilterQuery(next)}`, { scroll: false });
    });
  }

  function markOne(id: string) {
    if (items.some((n) => n.id === id && !n.read)) setReadHere((count) => count + 1);
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)),
    );
    void markNotificationRead(id);
  }

  function markAll() {
    setAllRead(true);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    void markAllNotificationsRead();
  }

  function completeAction(id: string) {
    // The bell keeps its own list: bring it along now rather than waiting for
    // the realtime echo of the row being marked read.
    shared?.completeAction(id);
    if (items.some((n) => n.id === id && !n.read)) setReadHere((count) => count + 1);
    setItems((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, read: true, action: n.action ? { ...n.action, status: "done" } : n.action }
          : n,
      ),
    );
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const page = await fetchNotificationPage(cursor, filter);
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.notifications.filter((n) => !seen.has(n.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      // Without this catch the spinner stopped and NOTHING happened, leaving
      // the user unable to tell "loading failed" from "there is no more".
      // The cursor is untouched, so the same click simply retries.
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {t("title")}
        </h1>
        <button
          type="button"
          onClick={markAll}
          disabled={!hasUnread}
          className={cn(secondaryButtonClass, "gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground")}
        >
          <CheckCheck aria-hidden className="size-4" />
          {t("markAllRead")}
        </button>
      </div>

      {/* Nothing to filter in a history that is empty and unfiltered. */}
      {(filtered || items.length > 0) && (
        <NotificationFilters filter={filter} facets={facets} onChange={applyFilter} />
      )}

      <div
        aria-busy={filtering}
        className={cn(
          "transition-opacity duration-base ease-standard motion-reduce:transition-none",
          filtering && "opacity-60",
        )}
      >
        {items.length === 0 ? (
          <div className={cn(cardClass, "py-16 text-center")}>
            {filtered ? (
              <>
                <p className="text-sm font-medium text-foreground">
                  {filter.unread && !filter.type
                    ? tFilters("emptyUnreadTitle")
                    : tFilters("emptyFilteredTitle")}
                </p>
                <p className={cn(helpTextClass, "mt-1")}>
                  {filter.unread && !filter.type
                    ? tFilters("emptyUnreadHint")
                    : tFilters("emptyFilteredHint")}
                </p>
                <button
                  type="button"
                  onClick={() => applyFilter(NO_NOTIFICATION_FILTER)}
                  className={cn(secondaryButtonClass, "mt-4 py-2")}
                >
                  {tFilters("clear")}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
                <p className={cn(helpTextClass, "mt-1")}>{t("emptyHint")}</p>
              </>
            )}
          </div>
        ) : (
          <ul className={cn(cardClass, "divide-y divide-border overflow-hidden")}>
            {items.map((n) => (
              <li key={n.id}>
                <NotificationItem
                  notification={n}
                  onActivate={(id) => markOne(id)}
                  onActionComplete={completeAction}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          {loadError && (
            <p role="alert" className={errorTextClass}>
              {t("loadError")}
            </p>
          )}
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className={cn(secondaryButtonClass, "py-2")}
          >
            {loadingMore && <Spinner />}
            {loadingMore ? t("loading") : loadError ? tCommon("tryAgain") : t("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
