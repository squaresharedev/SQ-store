"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestEmailChange,
  type SettingsActionState,
} from "@/lib/settings/actions";

const INITIAL: SettingsActionState = {};

/**
 * Email changes never touch the DB directly: Supabase sends a confirmation
 * link and the address only switches once it's clicked.
 */
export function EmailChangeForm({ email }: { email: string }) {
  const [state, formAction, isPending] = useActionState(
    requestEmailChange,
    INITIAL,
  );

  return (
    <SettingsCard
      title="Email"
      description="Changing it sends a confirmation link first. Nothing moves until you actually click it, so typos here are low stakes."
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <p className="font-inter text-sm text-neutral-500">
          Currently signed in as{" "}
          <span className="font-medium text-neutral-900">{email}</span>
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
        <FormStatus state={state} showSuccess />
        <div>
          <SaveButton
            pending={isPending}
            state={state}
            pendingLabel="Sending…"
            savedLabel="Sent"
          >
            Send confirmation link
          </SaveButton>
        </div>
      </form>
    </SettingsCard>
  );
}
