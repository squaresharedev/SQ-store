"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
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
 */
export function SignOutSection() {
  return (
    <SettingsCard
      title="Sign out"
      description="End this session on this device, or sign out everywhere to log out of every device at once."
    >
      <div className="flex flex-wrap items-center gap-3">
        <form action={signOut}>
          <SignOutButton
            variant="secondary"
            pendingLabel="Signing out…"
            trailingIcon={
              <LogOut aria-hidden className={cn("size-4", iconNudgeRightClass)} />
            }
          >
            Sign out
          </SignOutButton>
        </form>
        <form action={signOutEverywhere}>
          <SignOutButton variant="ghost" pendingLabel="Signing out…">
            Sign out everywhere
          </SignOutButton>
        </form>
      </div>
      <p className="mt-4 font-inter text-xs text-neutral-400">
        Signing out everywhere ends your session on every device and browser
        you&rsquo;re signed in on. You&rsquo;ll need to sign in again each place.
      </p>
    </SettingsCard>
  );
}
