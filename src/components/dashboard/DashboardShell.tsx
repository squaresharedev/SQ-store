import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ViewingBanner } from "@/components/layout/ViewingBanner";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import {
  getAccessibleAccounts,
  getActiveAccount,
} from "@/lib/team/account-context";
import { getProfile, getUser } from "@/lib/auth/session";

/**
 * The dashboard chrome: fixed left Sidebar + content offset by the rail width,
 * the notification bell, and the profile/account menu (which also holds the
 * multi-tenant store switcher). Resolves the active account + accessible stores
 * server-side so the switcher and the "viewing another store" banner stay
 * consistent everywhere the shell is used (the (dashboard) group + storefront
 * list).
 */
export async function DashboardShell({
  username,
  children,
}: {
  username: string;
  children: ReactNode;
}) {
  const [account, accounts, profile, user] = await Promise.all([
    getActiveAccount(),
    getAccessibleAccounts(),
    getProfile(),
    getUser(),
  ]);

  const currentAccountId = account?.accountId ?? "";
  const email = user?.email ?? "";
  const name = profile?.display_name?.trim() || email.split("@")[0] || username;
  const avatarUrl = profile?.avatar_url ?? null;

  const viewingOther = account && !account.isOwner ? account : null;
  const viewingStoreName = viewingOther
    ? accounts.find((a) => a.accountId === viewingOther.accountId)?.storeName ??
      "another store"
    : null;

  // Mobile: bell + profile menu ride in the Sidebar's mobile header.
  const mobileControls = (
    <div className="flex items-center gap-1">
      <NotificationBell />
      <ProfileMenu
        name={name}
        email={email}
        avatarUrl={avatarUrl}
        accounts={accounts}
        currentAccountId={currentAccountId}
      />
    </div>
  );

  return (
    <NotificationsProvider>
      <div className="min-h-screen bg-background">
        <Sidebar topBarSlot={mobileControls} />
        <div className="md:pl-64">
          <TopBar
            accounts={accounts}
            currentAccountId={currentAccountId}
            name={name}
            email={email}
            avatarUrl={avatarUrl}
          />
          {viewingOther && viewingStoreName && (
            <ViewingBanner
              storeName={viewingStoreName}
              role={viewingOther.role}
              ownAccountId={viewingOther.userId}
            />
          )}
          {children}
        </div>
      </div>
    </NotificationsProvider>
  );
}
