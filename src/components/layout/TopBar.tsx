import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import type { AccountOption } from "@/lib/team/account-context";

/**
 * Global dashboard top bar (desktop). A slim, sticky row carrying the
 * notification bell and the account/profile menu at the right, WITHOUT
 * disturbing each page's own title/actions — it sits above the page content as
 * its own thin row. Hidden under md, where these controls ride in the mobile
 * header (Sidebar `topBarSlot`).
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
    <div className="sticky top-0 z-20 hidden h-14 items-center justify-end gap-1 border-b border-border bg-background/80 px-6 backdrop-blur md:flex">
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
