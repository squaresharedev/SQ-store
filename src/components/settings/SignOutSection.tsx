"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { iconNudgeRightClass } from "@/components/ui/control-styles";
import { signOut, signOutEverywhere } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/**
 * Submit button that mirrors its parent <form>'s pending state. Both sign-out
 * actions redirect on success, so there's no result state to render — the
 * spinner just covers the server round-trip until the navigation to /login
 * lands.
 */
function SignOutButton({
  children,
  pendingLabel,
  trailingIcon,
  ...props
}: ButtonProps & {
  pendingLabel: string;
  trailingIcon?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (
        <>
          <Spinner />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          {trailingIcon}
        </>
      )}
    </Button>
  );
}

/**
 * Session controls. "Sign out" ends only the current session (Supabase scope
 * `local`); "Sign out everywhere" revokes every refresh token so all other
 * devices are logged out too (scope `global`). Each lives in its own <form>
 * so the pending spinner is scoped to exactly the button that was clicked.
 *
 * The everywhere variant wears `ghost-danger` — quiet at rest, destructive red
 * on hover/focus — because it is the one here with consequences beyond this
 * tab, without being a danger-zone CTA like account deletion.
 */
export function SignOutSection() {
  const t = useTranslations("Settings.account.signOut");
  return (
    <SettingsCard title={t("cardTitle")} description={t("cardDescription")}>
      <div className="flex flex-wrap items-center gap-3">
        <form action={signOut}>
          <SignOutButton
            variant="secondary"
            pendingLabel={t("signingOut")}
            trailingIcon={
              <LogOut aria-hidden className={cn("size-4", iconNudgeRightClass)} />
            }
          >
            {t("button")}
          </SignOutButton>
        </form>
        <form action={signOutEverywhere}>
          <SignOutButton variant="ghost-danger" pendingLabel={t("signingOut")}>
            {t("everywhereButton")}
          </SignOutButton>
        </form>
      </div>
      <p className="mt-4 font-inter text-xs text-muted-foreground">
        {t("everywhereNote")}
      </p>
    </SettingsCard>
  );
}
