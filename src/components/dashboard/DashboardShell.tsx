import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";

/**
 * The dashboard chrome: fixed left Sidebar + content offset by the rail width,
 * with the global notification bell (desktop top bar + mobile header slot).
 * Extracted so pages OUTSIDE the (dashboard) route group can opt into the same
 * shell — the storefront list wears it, while the full-screen storefront editor
 * deliberately does not.
 *
 * NotificationsProvider runs the single realtime subscription and feeds BOTH
 * bells (one desktop, one mobile) from one source of truth.
 */
export function DashboardShell({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  return (
    <NotificationsProvider>
      <div className="min-h-screen bg-background">
        <Sidebar username={username} topBarSlot={<NotificationBell />} />
        <div className="md:pl-64">
          <TopBar />
          {children}
        </div>
      </div>
    </NotificationsProvider>
  );
}
