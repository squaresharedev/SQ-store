"use client";

import * as React from "react";
import { CheckCheck } from "lucide-react";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { errorTextClass, helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { Spinner } from "@/components/ui/spinner";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import {
  fetchNotificationPage,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { Notification } from "@/lib/notifications/types";

/**
 * Full notification history. Self-contained: seeded with a server-rendered
 * first page, then paginates + mutates through server actions with optimistic
 * updates. The realtime bell reflects the same DB changes independently (via
 * its subscription), so the two stay consistent without shared client state.
 */
export function NotificationsPageClient({
  initial,
  initialCursor,
}: {
  initial: Notification[];
  initialCursor: string | null;
}) {
  const [items, setItems] = React.useState<Notification[]>(initial);
  const [cursor, setCursor] = React.useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);

  const hasUnread = items.some((n) => !n.read);

  function markOne(id: string) {
    setItems((prev) =>
      prev.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)),
    );
    void markNotificationRead(id);
  }

  function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    void markAllNotificationsRead();
  }

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const page = await fetchNotificationPage(cursor);
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
          Notifications
        </h1>
        <button
          type="button"
          onClick={markAll}
          disabled={!hasUnread}
          className={cn(secondaryButtonClass, "gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground")}
        >
          <CheckCheck aria-hidden className="size-4" />
          Mark all read
        </button>
      </div>

      {items.length === 0 ? (
        <div className={cn(cardClass, "py-16 text-center")}>
          <p className="text-sm font-medium text-foreground">No notifications yet</p>
          <p className={cn(helpTextClass, "mt-1")}>
            Team, order, and payment activity will show up here.
          </p>
        </div>
      ) : (
        <ul className={cn(cardClass, "divide-y divide-border overflow-hidden")}>
          {items.map((n) => (
            <li key={n.id}>
              <NotificationItem
                notification={n}
                onActivate={(id) => markOne(id)}
              />
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="mt-6 flex flex-col items-center gap-2">
          {loadError && (
            <p role="alert" className={errorTextClass}>
              Couldn&apos;t load more notifications. Check your connection and
              try again.
            </p>
          )}
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className={cn(secondaryButtonClass, "py-2")}
          >
            {loadingMore && <Spinner />}
            {loadingMore ? "Loading" : loadError ? "Try again" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
