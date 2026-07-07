"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/Popover";
import { NotificationList } from "@/components/notifications/NotificationList";
import { useNotificationsContext } from "@/components/notifications/NotificationsProvider";

/**
 * The bell: icon + unread-count badge, opening a Popover dropdown of recent
 * notifications. Reads all state from the shared context, so multiple bells
 * (desktop top bar + mobile header) stay in sync behind one subscription.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { notifications, unreadCount, loading, markRead, markAllRead } =
    useNotificationsContext();
  const [open, setOpen] = React.useState(false);

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  function handleActivate(id: string, href: string | null) {
    markRead(id);
    // A deep link closes the dropdown; NotificationItem does the navigation.
    if (href) setOpen(false);
  }

  const trigger = (
    <button
      type="button"
      aria-label={
        unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
      }
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "relative flex size-10 items-center justify-center rounded-[0.375rem] text-foreground",
        "transition-colors duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <Bell className="size-5" strokeWidth={2} aria-hidden />
      {!loading && unreadCount > 0 && (
        <span
          aria-hidden
          className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-semibold leading-4 text-destructive-foreground"
        >
          {badge}
        </span>
      )}
    </button>
  );

  // Constrain width to the 40px control: the shared Popover root is w-full, so
  // this box keeps the bell tight and anchors the (right-aligned) panel to it.
  return (
    <div className={cn("w-10 shrink-0", className)}>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger={trigger}
        label="Notifications"
        variant="anchored"
        panelClassName="w-[22rem] p-0 overflow-hidden"
      >
        <NotificationList
          notifications={notifications}
          unreadCount={unreadCount}
          loading={loading}
          onActivate={handleActivate}
          onMarkAll={markAllRead}
          onNavigateAway={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}
