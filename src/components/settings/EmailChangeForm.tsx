"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { useActionToast } from "@/components/ui/Toast";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { helpTextClass, iconNudgeRightClass } from "@/components/ui/control-styles";
import {
  requestEmailChange,
  type SettingsActionState,
} from "@/lib/settings/actions";
import { InfoTip } from "@/components/ui/InfoTip";

const INITIAL: SettingsActionState = {};

/**
 * Email changes never touch the DB directly: Supabase sends a confirmation
 * link and the address only switches once it's clicked.
 */
export function EmailChangeForm({
  email,
  hasPassword,
}: {
  email: string;
  /** OAuth-only accounts have no password, so they are not asked for one. */
  hasPassword: boolean;
}) {
  const [state, formAction, isPending] = useActionState(
    requestEmailChange,
    INITIAL,
  );
  useActionToast(state);

  return (
    <SettingsCard
      title="Email"
      description="Changing it sends a confirmation link first. Nothing moves until you actually click it, so typos here are low stakes."
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <p className={helpTextClass}>
          Currently signed in as{" "}
          <span className="font-medium text-foreground">{email}</span>
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new_email">New email</Label>
          <Input
            id="new_email"
            name="new_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@studio.com"
            required
          />
        </div>
        {hasPassword && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5">
              <Label htmlFor="email_current_password">Current password</Label>
              <InfoTip label="Why your password is needed here">
                Whoever controls your email address can reset your password, so
                changing it is a change to how you get back into the account.
                Your password confirms the change is really you.
              </InfoTip>
            </span>
            <PasswordInput
              id="email_current_password"
              name="current_password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
        )}
        <div>
          <SaveButton
            pending={isPending}
            state={state}
            pendingLabel="Sending…"
            savedLabel="Sent"
            // Plain text on the error state: it already carries an X, and a
            // "go" arrow beside it would point at an action that just failed.
            failedLabel="Send confirmation link"
          >
            Send confirmation link
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
