"use client";

import { useActionState, useState } from "react";
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
  const [state, formAction, isPending] = useActionState(
    requestEmailChange,
    INITIAL,
  );
  useActionToast(state);

  const [newEmail, setNewEmail] = useState("");

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
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
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
            {/* The password field is intentionally uncontrolled: it should
                always be re-entered after any action, success or failure,
                and the React 19 reset gives us that for free. */}
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
