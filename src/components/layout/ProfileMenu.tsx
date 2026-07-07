"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, LogOut, Store, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Popover } from "@/components/ui/Popover";
import { setActiveAccount } from "@/lib/team/actions";
import { signOut } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/team/permissions";
import type { AccountOption } from "@/lib/team/account-context";

const ITEM = cn(
  "flex w-full items-center gap-2.5 rounded-[0.375rem] px-2.5 py-2 text-left text-sm text-foreground",
  "transition-colors duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none",
  "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
);

/**
 * Account menu behind the top-bar avatar: Account, Switch accounts (inline list
 * of the stores you belong to — hidden when you only have your own), and Log
 * out. Switching persists server-side (setActiveAccount validates membership)
 * and refreshes so all account-scoped data reloads.
 */
export function ProfileMenu({
  name,
  email,
  avatarUrl,
  accounts,
  currentAccountId,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  accounts: AccountOption[];
  currentAccountId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [showAccounts, setShowAccounts] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const canSwitch = accounts.length > 1;

  // Collapse the accounts sub-list whenever the menu closes (so it opens tidy).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setShowAccounts(false);
  }

  function switchTo(id: string) {
    handleOpenChange(false);
    if (id === currentAccountId) return;
    startTransition(async () => {
      await setActiveAccount(id);
      router.refresh();
    });
  }

  const trigger = (
    <button
      type="button"
      aria-label="Account menu"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => handleOpenChange(!open)}
      className="flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Avatar src={avatarUrl} name={name} className="size-9" />
    </button>
  );

  return (
    <div className="w-9 shrink-0">
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        trigger={trigger}
        label="Account menu"
        variant="anchored"
        panelClassName="w-64 p-1"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-2.5 pb-2.5 pt-1.5">
          <Avatar src={avatarUrl} name={name} className="size-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {name}
            </span>
            <span className="block truncate font-inter text-xs text-muted-foreground">
              {email}
            </span>
          </span>
        </div>

        <div className="py-1">
          <Link href="/settings/account" onClick={() => setOpen(false)} className={ITEM}>
            <User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Account
          </Link>

          {canSwitch && (
            <>
              <button
                type="button"
                onClick={() => setShowAccounts((v) => !v)}
                aria-expanded={showAccounts}
                className={ITEM}
              >
                <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                Switch accounts
                <ChevronRight
                  className={cn(
                    "ml-auto size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                    showAccounts && "rotate-90",
                  )}
                  aria-hidden
                />
              </button>

              {showAccounts && (
                <ul className="mb-1 ml-2 border-l border-border pl-1.5">
                  {accounts.map((a) => (
                    <li key={a.accountId}>
                      <button
                        type="button"
                        onClick={() => switchTo(a.accountId)}
                        disabled={pending}
                        className={cn(ITEM, "disabled:opacity-60")}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {a.isSelf ? "Your store" : a.storeName}
                          </span>
                          <span className="block font-inter text-xs text-muted-foreground">
                            {a.isSelf ? "Owner" : ROLE_LABELS[a.role]}
                          </span>
                        </span>
                        {a.accountId === currentAccountId && (
                          <Check className="size-4 shrink-0 text-foreground" aria-hidden />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border py-1">
          <form action={signOut}>
            <button type="submit" className={cn(ITEM, "hover:text-destructive")}>
              <LogOut className="size-4 shrink-0" aria-hidden />
              Log out
            </button>
          </form>
        </div>
      </Popover>
    </div>
  );
}
