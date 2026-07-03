"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import {
  changePassword,
  sendPasswordReset,
  type SettingsActionState,
} from "@/lib/settings/actions";

const INITIAL: SettingsActionState = {};

/** Runs through Supabase auth, gated on re-entering the current password. */
export function PasswordChangeForm() {
  const [state, formAction, isPending] = useActionState(
    changePassword,
    INITIAL,
  );

  return (
    <SettingsCard
      title="Password"
      description="We ask for your current password first, just to double-check it's really you."
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current_password">Current password</Label>
          <PasswordInput
            id="current_password"
            name="current_password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new_password">New password</Label>
          <PasswordInput
            id="new_password"
            name="new_password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
          <p className="font-inter text-xs text-neutral-400">
            At least 8 characters.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm_password">Confirm new password</Label>
          <PasswordInput
            id="confirm_password"
            name="confirm_password"
            autoComplete="new-password"
            placeholder="••••••••"
            required
          />
        </div>
        <FormStatus state={state} />
        <div>
          <SaveButton pending={isPending} state={state} pendingLabel="Updating…">
            Update password
          </SaveButton>
        </div>
      </form>

      <ForgotPasswordReset />
    </SettingsCard>
  );
}

/**
 * Escape hatch for when the current password is forgotten: emails a recovery
 * link to the account address. Sits under the change form, quietly, so it's
 * only reached for when you actually need it.
 */
function ForgotPasswordReset() {
  const [state, formAction, isPending] = useActionState(
    sendPasswordReset,
    INITIAL,
  );

  return (
    <div className="mt-6 border-t border-neutral-200 pt-5">
      <p className="font-inter text-sm text-neutral-500">
        Don&rsquo;t remember your current password?
      </p>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        <FormStatus state={state} showSuccess />
        <div>
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? (
              <>
                <Spinner />
                Sending…
              </>
            ) : (
              "Email me a reset link"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
