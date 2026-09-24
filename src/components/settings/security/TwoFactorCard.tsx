"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Plus, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useActionToast } from "@/components/ui/Toast";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { StepUpField } from "@/components/auth/StepUp";
import { TwoFactorSetupModal } from "@/components/settings/security/TwoFactorSetupModal";
import type { SecurityFactor } from "@/components/settings/security/SecuritySection";
import { removeAuthenticator, type ManageState } from "@/lib/auth/mfa-actions";
import { cn } from "@/lib/utils";

const MANAGE_INITIAL: ManageState = {};

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** Why bother, in the three sentences a busy seller will actually read. */
const BENEFITS = [
  "A stolen or guessed password is no longer enough to get into your store.",
  "Changes to your business details, your team and your account need a code from your phone.",
  "You get an email the moment someone gets your password right but the code wrong.",
];

/**
 * The two-factor switch. Off: the case for turning it on, and the button that
 * starts it. On: the authenticators that can sign in, each removable, plus
 * "add another" for a backup phone.
 */
export function TwoFactorCard({
  enrolled,
  factors,
  hasPassword,
  signedInRecently,
  signsInWithGoogle,
  openSetup,
}: {
  enrolled: boolean;
  factors: SecurityFactor[];
  hasPassword: boolean;
  signedInRecently: boolean;
  signsInWithGoogle: boolean;
  openSetup: boolean;
}) {
  const [setupOpen, setSetupOpen] = React.useState(openSetup);
  const [removing, setRemoving] = React.useState<SecurityFactor | null>(null);
  const closeSetup = React.useCallback(() => setSetupOpen(false), []);
  const closeRemove = React.useCallback(() => setRemoving(null), []);

  return (
    <SettingsCard
      id="two-factor"
      title="Two-factor authentication"
      description={
        enrolled
          ? "Signing in needs your password and a code from your authenticator app."
          : "Add a second step to signing in: a 6-digit code from an app on your phone."
      }
      decoration={enrolled ? undefined : "dots"}
    >
      <div className="flex flex-col gap-5">
        <p
          className={cn(
            "inline-flex w-fit items-center gap-1.5 border px-2 py-1 font-inter text-xs font-semibold",
            enrolled
              ? "border-foreground text-foreground"
              : "border-border text-muted-foreground",
          )}
          data-two-factor-status={enrolled ? "on" : "off"}
        >
          <ShieldCheck aria-hidden className="size-3.5" />
          {enrolled ? "On" : "Off"}
        </p>

        {enrolled ? (
          <>
            <ul className="divide-y divide-border border-y border-border" aria-label="Authenticator apps">
              {factors.map((factor) => (
                <li
                  key={factor.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Smartphone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate font-inter text-sm font-medium text-foreground">
                        {factor.name}
                      </p>
                      <p className={infoTextClass}>Added {formatDay(factor.createdAt)}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost-danger"
                    onClick={() => setRemoving(factor)}
                    aria-label={`Remove ${factor.name}`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button type="button" variant="secondary" onClick={() => setSetupOpen(true)}>
                <Plus aria-hidden className="size-4" />
                Add another authenticator
              </Button>
            </div>
          </>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className={cn(helpTextClass, "flex items-start gap-2")}>
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => setSetupOpen(true)}>
                <ShieldCheck aria-hidden className="size-4" />
                Set up two-factor authentication
              </Button>
              <span className={infoTextClass}>Takes about a minute.</span>
            </div>
          </>
        )}
      </div>

      {/* Mounted outside the on/off branches above: finishing setup flips the
          card to "on" underneath the modal, and the modal (with the recovery
          codes it is about to show) must survive that re-render. */}
      <TwoFactorSetupModal
        key={setupOpen ? "open" : "closed"}
        open={setupOpen}
        onClose={closeSetup}
        adding={enrolled}
        hasPassword={hasPassword}
        signedInRecently={signedInRecently}
        signsInWithGoogle={signsInWithGoogle}
        existingNames={factors.map((factor) => factor.name)}
      />
      <RemoveAuthenticatorModal
        key={removing?.id ?? "none"}
        factor={removing}
        isLast={factors.length <= 1}
        onClose={closeRemove}
      />
    </SettingsCard>
  );
}

/**
 * Removing an authenticator always takes a code in the same request: turning
 * the protection off must require the protection. Removing the LAST one turns
 * 2FA off entirely and voids the recovery codes, and says so first.
 */
function RemoveAuthenticatorModal({
  factor,
  isLast,
  onClose,
}: {
  factor: SecurityFactor | null;
  isLast: boolean;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(removeAuthenticator, MANAGE_INITIAL);
  // Success as a toast (the modal closes, so an inline line would vanish with
  // it); errors stay inline beside the code they are about. Memoised on the
  // state object, because the toast hook announces each NEW object it sees.
  const announced = React.useMemo(
    () => (state.success ? { success: state.success } : undefined),
    [state],
  );
  useActionToast(announced);

  React.useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  if (!factor) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={isLast ? "Turn off two-factor authentication?" : `Remove "${factor.name}"?`}
      description={
        isLast
          ? "This is your only authenticator. Removing it turns two-factor authentication off, and your recovery codes stop working. Signing in will need only your password."
          : `"${factor.name}" will no longer be able to sign in to your account.`
      }
      className="rounded-none sm:rounded-none"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="factor_id" value={factor.id} />
        <StepUpField
          id="remove-factor"
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
          <Button type="submit" variant="destructive" disabled={isPending} suppressHydrationWarning>
            {isPending ? (
              <>
                <Spinner />
                Removing…
              </>
            ) : isLast ? (
              "Turn off"
            ) : (
              "Remove"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
