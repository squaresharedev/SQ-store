"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/Popover";
import {
  focusRingClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { NotificationList } from "@/components/notifications/NotificationList";
import { useNotificationsContext } from "@/components/notifications/NotificationsProvider";

/**
 * The bell: icon + unread-count badge, opening a Popover dropdown of recent
 * notifications. Reads all state from the shared context, so multiple bells
 * (desktop top bar + mobile header) stay in sync behind one subscription.
 */
export function NotificationBell({ className }: { className?: string }) {
  const {
    notifications,
    unreadCount,
    loading,
    arrivalSeq,
    status,
    markRead,
    markAllRead,
  } = useNotificationsContext();
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
        // `group/bell` is the hover/focus scope the bell-nudge CSS keys off.
        "group/bell relative flex size-10 items-center justify-center rounded-sm text-foreground hover:bg-accent",
        transitionClass,
        focusRingClass,
      )}
    >
      {/* The hover background, played back on arrival so a notification landing
          while the user is working elsewhere on the page still strikes them.
          Keyed like the icon below, and behind it: the badge and glyph stay
          fully legible while the accent swells and fades. */}
      {arrivalSeq > 0 && (
        <span
          key={`flash-${arrivalSeq}`}
          aria-hidden
          className="bell-arrival-flash pointer-events-none absolute inset-0 rounded-sm bg-accent"
        />
      )}
      {/* `key` restarts the ring on every arrival: a changed key remounts the
          icon, which replays the CSS animation from 0 — no state, no timers,
          and back-to-back notifications each get their own ring. */}
      <Bell
        key={arrivalSeq}
        className={cn(
          // `relative` keeps the glyph above the absolutely-positioned flash.
          "bell-icon relative size-5",
          arrivalSeq > 0 && "animate-bell-ring",
        )}
        strokeWidth={2}
        aria-hidden
      />
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
          live={status !== "error"}
          onActivate={handleActivate}
          onMarkAll={markAllRead}
          onNavigateAway={() => setOpen(false)}
        />
      </Popover>
    </div>
  );
}
