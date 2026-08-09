"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
  ghostButtonClass,
  overlayItemClass,
} from "@/components/ui/control-styles";
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
  live = true,
  onActivate,
  onMarkAll,
  onNavigateAway,
}: {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  /** False when the realtime channel is down: the list is stale, say so. */
  live?: boolean;
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
          className={cn(
            ghostButtonClass,
            "min-h-0 gap-1 px-1.5 py-1 font-inter text-xs",
          )}
        >
          <CheckCheck aria-hidden className="size-3.5" />
          Mark all read
        </button>
      </div>

      {/* Realtime channel down: the list still works but no longer updates
          itself. Without this line a broken subscription silently freezes the
          bell and the user has no reason to refresh. */}
      {!live && (
        <p
          role="status"
          className="border-b border-border bg-muted px-3 py-1.5 font-inter text-xs text-muted-foreground"
        >
          Live updates paused. Refresh to see the latest.
        </p>
      )}

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
          className={cn(overlayItemClass, "justify-center font-medium")}
        >
          View all
        </Link>
      </div>
    </div>
  );
}
