"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import {
  changePassword,
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
      description="We ask for your current password first. An open laptop shouldn't be enough to lock you out."
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
          <SaveButton pending={isPending} pendingLabel="Updating…">
            Update password
          </SaveButton>
        </div>
      </form>
    </SettingsCard>
  );
}
