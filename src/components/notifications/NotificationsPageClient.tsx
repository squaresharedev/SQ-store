"use client";

import * as React from "react";
import { CheckCheck } from "lucide-react";
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
    try {
      const page = await fetchNotificationPage(cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.notifications.filter((n) => !seen.has(n.id))];
      });
      setCursor(page.nextCursor);
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
          className="flex items-center gap-1.5 rounded-[0.375rem] border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40"
        >
          <CheckCheck aria-hidden className="size-4" />
          Mark all read
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-border bg-card py-16 text-center">
          <p className="text-sm font-medium text-foreground">No notifications yet</p>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Team, order, and payment activity will show up here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
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
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 rounded-[0.375rem] border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
          >
            {loadingMore && <Spinner />}
            {loadingMore ? "Loading" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
