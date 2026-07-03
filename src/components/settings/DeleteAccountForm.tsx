"use client";

import * as React from "react";
import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
  type SettingsActionState,
} from "@/lib/settings/actions";
import { DELETE_CONFIRM_PHRASE } from "@/lib/settings/constants";

const INITIAL: SettingsActionState = {};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Deliberate, two-step deletion: reveal, then type-to-confirm. Submitting
 * flags the account for deletion (soft flag + server log). The full
 * hard-delete cascade runs as a service-role job, never from here.
 */
export function DeleteAccountForm({
  deletionRequestedAt,
}: {
  deletionRequestedAt: string | null;
}) {
  const [armed, setArmed] = React.useState(false);
  const [phrase, setPhrase] = React.useState("");
  const [deleteState, deleteAction, deletePending] = useActionState(
    requestAccountDeletion,
    INITIAL,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelAccountDeletion,
    INITIAL,
  );

  if (deletionRequestedAt) {
    return (
      <SettingsCard
        title="Deletion requested"
        description={`You asked us to delete this account on ${formatDate(deletionRequestedAt)}. It's flagged for permanent deletion, products and storefront included. Until that actually runs, you can still change your mind.`}
        danger
      >
        <form action={cancelAction} className="flex flex-col gap-4">
          <FormStatus state={cancelState} />
          <div>
            <SaveButton
              variant="secondary"
              pending={cancelPending}
              state={cancelState}
              pendingLabel="Cancelling…"
            >
              Keep my account
            </SaveButton>
          </div>
        </form>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Delete account"
      description="This flags your account, products and storefront for permanent deletion. No soft-pedaling: once it runs, it's gone."
      danger
    >
      {!armed ? (
        <Button variant="destructive" onClick={() => setArmed(true)}>
          Delete my account
        </Button>
      ) : (
        <form action={deleteAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm" className="text-red-600">
              Type{" "}
              <span className="font-mono text-xs">
                {DELETE_CONFIRM_PHRASE}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm"
              name="confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={DELETE_CONFIRM_PHRASE}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <FormStatus state={deleteState} />
          <div className="flex flex-wrap items-center gap-3">
            <SaveButton
              variant="destructive"
              pending={deletePending}
              state={deleteState}
              pendingLabel="Flagging…"
              disabled={
                deletePending ||
                phrase.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE
              }
            >
              Permanently delete
            </SaveButton>
            <Button
              variant="ghost"
              onClick={() => {
                setArmed(false);
                setPhrase("");
              }}
            >
              Never mind
            </Button>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}
