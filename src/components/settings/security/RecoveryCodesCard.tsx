"use client";

import * as React from "react";
import { useActionState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { helpTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { StepUpField } from "@/components/auth/StepUp";
import { RecoveryCodesDisplay } from "@/components/settings/security/RecoveryCodesDisplay";
import { regenerateRecoveryCodes, type ManageState } from "@/lib/auth/mfa-actions";
import { RECOVERY_CODES_LOW, RECOVERY_CODE_COUNT } from "@/lib/auth/recovery-codes";

const INITIAL: ManageState = {};

/**
 * How many recovery codes are left, and a way to replace the whole set. The
 * codes themselves are never shown again after they are created: the server
 * holds only hashes.
 */
export function RecoveryCodesCard({ remaining }: { remaining: number | null }) {
  const [open, setOpen] = React.useState(false);
  const low = remaining !== null && remaining <= RECOVERY_CODES_LOW;
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <SettingsCard
      id="recovery-codes"
      title="Recovery codes"
      description="One-time codes for signing in if you lose your phone. Keep them somewhere other than the phone itself."
    >
      <div className="flex flex-col gap-4">
        {remaining === null ? (
          <p className={helpTextClass}>We couldn&rsquo;t check how many you have left.</p>
        ) : (
          <p
            className={low ? "flex items-start gap-2 font-inter text-sm text-destructive" : helpTextClass}
            data-recovery-remaining={remaining}
          >
            {low && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>
              {remaining} of {RECOVERY_CODE_COUNT} codes left.
              {remaining === 0
                ? " You have none left: generate a new set now."
                : low
                  ? " Running low: generate a new set."
                  : ""}
            </span>
          </p>
        )}
        <div>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            <RefreshCw aria-hidden className="size-4" />
            Generate new codes
          </Button>
        </div>
      </div>

      <RegenerateModal key={open ? "open" : "closed"} open={open} onClose={close} />
    </SettingsCard>
  );
}

function RegenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, formAction, isPending] = useActionState(regenerateRecoveryCodes, INITIAL);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={state.codes ? "Your new recovery codes" : "Generate new recovery codes?"}
      description={
        state.codes
          ? "Your old codes no longer work."
          : "Your current codes stop working as soon as the new ones are made."
      }
      className="rounded-none sm:rounded-none"
    >
      {state.codes ? (
        <RecoveryCodesDisplay codes={state.codes} onDone={onClose} />
      ) : (
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <StepUpField
            id="regenerate-codes"
            state={state}
            always
            description="Enter a current code from your authenticator app to confirm."
          />
          {state.error && (
            <p role="alert" className="font-inter text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} suppressHydrationWarning>
              {isPending ? (
                <>
                  <Spinner />
                  Generating…
                </>
              ) : (
                "Generate new codes"
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
