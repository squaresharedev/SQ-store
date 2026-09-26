"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronRight, Languages, LogOut, Store, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocaleSwitch } from "@/i18n/LocaleSwitchProvider";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";
import { Avatar } from "@/components/ui/avatar";
import { Popover } from "@/components/ui/Popover";
import {
  focusRingClass,
  overlayItemClass,
} from "@/components/ui/control-styles";
import { setActiveAccount } from "@/lib/team/actions";
import { signOut } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/team/permissions";
import type { AccountOption } from "@/lib/team/account-context";

const ITEM = cn(overlayItemClass, "px-2.5");

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
  const [showLanguages, setShowLanguages] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const canSwitch = accounts.length > 1;
  const locale = useLocale();
  const { switchLocale } = useLocaleSwitch();
  const tLocale = useTranslations("LocaleSwitcher");
  const t = useTranslations("Nav.profileMenu");
  const tAll = useTranslations();

  // Collapse the sub-lists whenever the menu closes (so it opens tidy).
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setShowAccounts(false);
      setShowLanguages(false);
    }
  }

  function chooseLocale(next: Locale) {
    handleOpenChange(false);
    switchLocale(next);
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
      aria-label={t("label")}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => handleOpenChange(!open)}
      className={cn(
        "flex items-center justify-center rounded-full",
        // Grows on hover/focus so it reads as a control, not a static portrait.
        // Transform-only (no layout shift), and it holds the larger size while
        // the menu is open so the trigger stays visibly active.
        "transition-transform duration-base ease-standard motion-reduce:transition-none",
        "hover:scale-110 focus-visible:scale-110 active:scale-105",
        open && "scale-110",
        focusRingClass,
      )}
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
        label={t("label")}
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
            {t("account")}
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
                {t("switchAccounts")}
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
                            {a.isSelf ? t("yourStore") : a.storeName}
                          </span>
                          <span className="block font-inter text-xs text-muted-foreground">
                            {a.isSelf ? t("owner") : tAll(ROLE_LABELS[a.role])}
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
          <button
            type="button"
            onClick={() => setShowLanguages((v) => !v)}
            aria-expanded={showLanguages}
            className={ITEM}
          >
            <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {tLocale("label")}
            <span className="ml-auto truncate font-inter text-xs text-muted-foreground">
              {LOCALE_NAMES[locale]}
            </span>
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                showLanguages && "rotate-90",
              )}
              aria-hidden
            />
          </button>

          {showLanguages && (
            <ul className="mb-1 ml-2 border-l border-border pl-1.5">
              {LOCALES.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    // Each name is in its own language; `lang` lets a screen
                    // reader pronounce "Čeština" as Czech, not as English.
                    lang={code}
                    onClick={() => chooseLocale(code)}
                    disabled={pending}
                    aria-current={code === locale ? "true" : undefined}
                    className={cn(ITEM, "disabled:opacity-60")}
                  >
                    <span className="min-w-0 flex-1 truncate">{LOCALE_NAMES[code]}</span>
                    {code === locale && (
                      <Check className="size-4 shrink-0 text-foreground" aria-hidden />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border py-1">
          <form action={signOut}>
            <button type="submit" className={cn(ITEM, "hover:text-destructive")}>
              <LogOut className="size-4 shrink-0" aria-hidden />
              {t("logOut")}
            </button>
          </form>
        </div>
      </Popover>
    </div>
  );
}
