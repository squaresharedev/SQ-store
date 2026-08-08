import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import type { AccountOption } from "@/lib/team/account-context";

/**
 * Global dashboard top bar (desktop). A slim, sticky row carrying universal
 * search at the left and the notification bell + account/profile menu at the
 * right, WITHOUT disturbing each page's own title/actions — it sits above the
 * page content as its own thin row. Hidden under md, where these controls ride
 * in the mobile header (Sidebar `topBarSlot`).
 */
export function TopBar({
  accounts,
  currentAccountId,
  name,
  email,
  avatarUrl,
}: {
  accounts: AccountOption[];
  currentAccountId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}) {
  return (
    <div
      data-testid="top-bar"
      className="sticky top-0 z-20 hidden h-14 items-center gap-1 border-b border-border bg-background/80 px-6 backdrop-blur md:flex"
    >
      <SearchTrigger />
      {/* Pushes the account controls back to the right edge now that the left
          half is occupied. */}
      <div className="flex-1" />
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
}
