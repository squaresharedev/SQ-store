import type { ReactNode } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getProfile, getUser } from "@/lib/auth/session";

/**
 * Chrome for the storefront LIST only.
 *
 * WHY THIS ROUTE GROUP EXISTS. /storefront and /storefront/[id] want different
 * chrome: the list wears the dashboard shell, the editor is full-screen with no
 * sidebar. That is why the section sits outside the (dashboard) group in the
 * first place. The list page used to render <DashboardShell> itself, which
 * looked equivalent but was not, because loading.tsx renders in place of the
 * PAGE, inside the LAYOUT:
 *
 *   - navigating to /storefront showed the list skeleton with no sidebar at
 *     all, so the left menu vanished for the length of the query and the
 *     skeleton stretched across where it had been;
 *   - and since a loading.tsx also covers nested segments, opening the editor
 *     at /storefront/[id] briefly showed the *storefront list* skeleton.
 *
 * Putting the shell in a layout that wraps only the list fixes both: the
 * skeleton now renders inside the same chrome as the page it stands in for, and
 * the editor no longer inherits a fallback meant for the list. Route groups do
 * not affect the URL, so /storefront is unchanged.
 *
 * Auth is already enforced one level up in storefront/layout.tsx; the session
 * reads here are cache()-wrapped, so this costs no extra round trips.
 */
export default async function StorefrontListLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [user, profile] = await Promise.all([getUser(), getProfile()]);
  const username =
    profile?.display_name || user?.email?.split("@")[0] || "Account";

  return <DashboardShell username={username}>{children}</DashboardShell>;
}
