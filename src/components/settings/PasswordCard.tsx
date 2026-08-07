"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { PasswordModal } from "@/components/settings/PasswordModal";

/**
 * The password surface, rendered for EVERY account.
 *
 * It used to be hidden behind `hasPassword`, computed from
 * `identities.some(i => i.provider === "email")`. That was wrong twice over: an
 * OAuth account that had since set a password still reported false (so its
 * owner could not change it), and an OAuth account that genuinely had none was
 * given no way to set one, leaving it locked to Google forever. Both cases want
 * this card; only the copy differs.
 */
export function PasswordCard({
  hasPassword,
  email,
}: {
  /** Resolved server-side from the password hash, not from `identities`. */
  hasPassword: boolean;
  email: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <SettingsCard
      title="Password"
      description={
        hasPassword
          ? "Change it whenever you like. We ask for the current one first, just to double-check it's really you."
          : "You sign in with Google. Add a password to sign in with your email or username too."
      }
    >
      <Button
        type="button"
        // Primary when there is no password yet: that is a setup step the
        // account genuinely needs, not a routine tweak.
        variant={hasPassword ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
      >
        {hasPassword ? "Change password" : "Set a password"}
      </Button>

      {/* Keyed on `open` so each opening is a fresh mount: no stale view and no
          leftover success or error text from the previous attempt. */}
      <PasswordModal
        key={open ? "open" : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        hasPassword={hasPassword}
        email={email}
      />
    </SettingsCard>
  );
}
