"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateDisplayName,
  type SettingsActionState,
} from "@/lib/settings/actions";

const INITIAL: SettingsActionState = {};

export function DisplayNameForm({ displayName }: { displayName: string }) {
  const [state, formAction, isPending] = useActionState(
    updateDisplayName,
    INITIAL,
  );

  return (
    <SettingsCard
      title="Display name"
      description="What buyers see on your storefront and in the marketplace."
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">Name</Label>
          <Input
            id="display_name"
            name="display_name"
            defaultValue={displayName}
            placeholder="builderboy"
            maxLength={50}
            autoComplete="nickname"
            required
          />
        </div>
        <FormStatus state={state} />
        <div>
          <SaveButton pending={isPending} />
        </div>
      </form>
    </SettingsCard>
  );
}
