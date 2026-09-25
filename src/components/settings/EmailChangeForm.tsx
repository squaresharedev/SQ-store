"use client";

import { useActionState, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { helpTextClass, iconNudgeRightClass } from "@/components/ui/control-styles";
import {
  requestEmailChange,
} from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";
import { InfoTip } from "@/components/ui/InfoTip";
import { StepUpField } from "@/components/auth/StepUp";

const INITIAL: ActionState = {};

/**
 * Email changes never touch the DB directly: Supabase sends a confirmation
 * link and the address only switches once it's clicked.
 *
 * WHY new_email IS CONTROLLED. React 19 resets an uncontrolled form after
 * any form action completes, success or failure. Clearing the new address on
 * a failed save (e.g. wrong password) forced the seller to retype an address
 * that was not the problem. `new_email` is controlled and never cleared
 * automatically: on success the toast already says "check your inbox" and
 * the field shows which address the link was sent to, which is useful context.
 * The password field is intentionally uncontrolled, so React 19's reset clears
 * it after every action — it should always be re-entered.
 */
export function EmailChangeForm({
  email,
  hasPassword,
}: {
  email: string;
  /** OAuth-only accounts have no password, so they are not asked for one. */
  hasPassword: boolean;
}) {
  const t = useTranslations("Settings.account.email");
  const tCommon = useTranslations("Common.actions");
  const [state, formAction, isPending] = useActionState(
    requestEmailChange,
    INITIAL,
  );
  useActionStateToast(state);
  const saveResult = useSaveResult(state);

  const [newEmail, setNewEmail] = useState("");

  return (
    <SettingsCard
      title={t("cardTitle")}
      description={t("cardDescription")}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <p className={helpTextClass}>
          {t.rich("currentlySignedInAs", {
            email,
            address: (chunks) => (
              <span className="font-medium text-foreground">{chunks}</span>
            ),
          })}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new_email">{t("newEmailLabel")}</Label>
          <Input
            id="new_email"
            name="new_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t("newEmailPlaceholder")}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
        </div>
        {hasPassword && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="email_current_password">
                {t("currentPasswordLabel")}
              </Label>
              <InfoTip label={t("passwordTipLabel")}>{t("passwordTipBody")}</InfoTip>
            </span>
            {/* The password field is intentionally uncontrolled: it should
                always be re-entered after any action, success or failure,
                and the React 19 reset gives us that for free. Never
                revealable: it holds the account's existing password. */}
            <PasswordInput
              id="email_current_password"
              name="current_password"
              revealable={false}
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
        )}
        {/* No password on the account means the code is the only proof, so
            the server wants one in every request (not just a recent one). */}
        <StepUpField id="email-change" state={state} requireFresh={!hasPassword} />
        <div>
          <SaveButton
            pending={isPending}
            state={saveResult}
            pendingLabel={tCommon("sending")}
            savedLabel={tCommon("sent")}
            // Plain text on the error state: it already carries an X, and a
            // "go" arrow beside it would point at an action that just failed.
            failedLabel={t("sendConfirmationLink")}
          >
            {t("sendConfirmationLink")}
            {/* Trailing arrow = a "go / next" action (styles.md §6.2); the
                shared nudge class slides it on hover and keyboard focus. */}
            <ArrowRight
              className={`size-4 ${iconNudgeRightClass}`}
              strokeWidth={2}
              aria-hidden
            />
          </SaveButton>
        </div>
      </form>
    </SettingsCard>
  );
}
