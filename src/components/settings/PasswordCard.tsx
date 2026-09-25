"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("Settings.account.password");
  const [open, setOpen] = React.useState(false);

  return (
    <SettingsCard
      title={t("cardTitle")}
      description={
        hasPassword ? t("descriptionNeverShown") : t("descriptionNoPassword")
      }
    >
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        {hasPassword ? t("resetButton") : t("setButton")}
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
