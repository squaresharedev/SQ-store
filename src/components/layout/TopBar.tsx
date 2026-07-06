import { NotificationBell } from "@/components/notifications/NotificationBell";

/**
 * Global dashboard top bar (desktop). A slim, sticky, right-aligned slot that
 * carries the notification bell across every dashboard page WITHOUT disturbing
 * each page's own title/actions — it sits above the page content as its own
 * thin row. Hidden under md, where the bell rides in the mobile header beside
 * the hamburger instead (see DashboardShell → Sidebar `topBarSlot`).
 *
 * Kept minimal on purpose: no page title or search here, so pages keep full
 * ownership of their headers (e.g. "Save storefront" actions are untouched).
 */
export function TopBar() {
  return (
    <div className="sticky top-0 z-20 hidden h-14 items-center justify-end gap-2 border-b border-border bg-background/80 px-6 backdrop-blur md:flex">
      <NotificationBell />
    </div>
  );
}
