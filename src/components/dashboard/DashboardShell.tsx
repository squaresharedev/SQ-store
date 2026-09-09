import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ViewingBanner } from "@/components/layout/ViewingBanner";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { SearchProvider } from "@/components/search/SearchProvider";
import { SearchMobileTrigger } from "@/components/search/SearchMobileTrigger";
import { SellerDetailsBanner } from "@/components/settings/SellerDetailsNotice";
import {
  getAccessibleAccounts,
  getActiveAccount,
} from "@/lib/team/account-context";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
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
  const name = profile?.username?.trim() || email.split("@")[0] || username;
  const avatarUrl = profile?.avatar_url ?? null;

  const viewingOther = account && !account.isOwner ? account : null;
  const viewingStoreName = viewingOther
    ? accounts.find((a) => a.accountId === viewingOther.accountId)?.storeName ??
      "another store"
    : null;

  // The publish gate, stated once in the chrome so it is visible from whatever
  // page the seller is on rather than only from the one they happen to be
  // blocked by. Scoped to the ACTIVE account: a team member working on someone
  // else's store sees that store's gap, because it is that store's listings the
  // gap is holding back. A read failure shows nothing — the write paths still
  // refuse, and a banner that appears because a query blipped is worse than no
  // banner at all.
  const identity = account ? await getTraderIdentityStatus(account.accountId) : null;
  const missingTraderDetails = identity?.ok ? identity.missing : [];

  // Mobile: search + bell + profile menu ride in the Sidebar's mobile header.
  const mobileControls = (
    <div className="flex items-center gap-1">
      <SearchMobileTrigger />
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
      {/* Universal search wraps the whole shell so ⌘K works from any page that
          wears it, and the palette renders above the sidebar and its drawer. */}
      <SearchProvider
        role={account?.role ?? null}
        accountId={account?.accountId ?? null}
      >
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
            {/* Under the "viewing another store" banner, because which store
                this is about has to be read first for the warning to mean
                anything. */}
            <SellerDetailsBanner missing={missingTraderDetails} />
            {children}
          </div>
        </div>
      </SearchProvider>
    </NotificationsProvider>
  );
}
