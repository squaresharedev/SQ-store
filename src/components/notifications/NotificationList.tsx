"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import type { Notification } from "@/lib/notifications/types";

/**
 * The dropdown body: a header with "Mark all read", the recent notifications,
 * and a "View all" footer linking to the full history. Presentational — the
 * bell owns the data (from context) and passes it in.
 */
const DROPDOWN_LIMIT = 8;

export function NotificationList({
  notifications,
  unreadCount,
  loading,
  onActivate,
  onMarkAll,
  onNavigateAway,
}: {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  onActivate: (id: string, href: string | null) => void;
  onMarkAll: () => void;
  /** Called when the user follows a link out of the dropdown (to close it). */
  onNavigateAway: () => void;
}) {
  const recent = notifications.slice(0, DROPDOWN_LIMIT);

  return (
    <div className="flex max-h-[75vh] w-full flex-col sm:max-h-[26rem]">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-1.5 font-inter text-xs font-normal text-muted-foreground">
              {unreadCount} unread
            </span>
          )}
        </h2>
        <button
          type="button"
          onClick={onMarkAll}
          disabled={unreadCount === 0}
          className="flex items-center gap-1 rounded-[0.375rem] px-1.5 py-1 font-inter text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <CheckCheck aria-hidden className="size-3.5" />
          Mark all read
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Spinner />
          </div>
        ) : recent.length === 0 ? (
          <p className="px-3 py-10 text-center font-inter text-sm text-muted-foreground">
            You&apos;re all caught up. Nothing here yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((n) => (
              <li key={n.id}>
                <NotificationItem notification={n} onActivate={onActivate} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Link
          href="/notifications"
          onClick={onNavigateAway}
          className="block rounded-[0.375rem] py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all
        </Link>
      </div>
    </div>
  );
}
