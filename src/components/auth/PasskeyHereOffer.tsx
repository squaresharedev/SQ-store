"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { helpTextClass } from "@/components/ui/control-styles";
import { AnimatedFingerprint } from "@/components/auth/AnimatedFingerprint";
import { SuccessMark, type SuccessKind } from "@/components/auth/SuccessMark";
import { useDeviceName } from "@/components/auth/useDeviceName";
import {
  beginPasskeyHere,
  cancelTwoFactorSetup,
  confirmPasskeyHere,
} from "@/lib/auth/mfa-actions";
import { suggestedName } from "@/lib/auth/factor-names";
import type { DeviceLabel } from "@/lib/auth/device-label";
import { createPasskey } from "@/lib/auth/webauthn-client";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { useStoredFlag } from "@/lib/hooks/useStoredFlag";

/**
 * Remembers on this device that the offer was answered, either way: "Not now",
 * or a passkey made here (which is then what signs in here, so there is
 * nothing left to offer). The offer is about this device only.
 */
export const PASSKEY_HERE_DISMISSED_KEY = "sq.auth.passkey-here-dismissed";

/** Read by the challenge to decide whether to offer at all. */
export function usePasskeyHereDismissed(): [boolean, (value: boolean) => void] {
  return useStoredFlag(PASSKEY_HERE_DISMISSED_KEY);
}

type Phase = "offer" | "working" | "added";

/**
 * "Skip the phone next time": at the end of a sign-in that had to go through
 * ANOTHER device (an approval from the phone, or a code from an app), the
 * offer to create a passkey on THIS one, so the next sign-in here is one tap.
 * The answer to "my phone says there's no passkey": make one where it's needed.
 *
 * Allowed without another proof because the challenge was passed moments ago
 * (see beginPasskeyHere). Nothing is asked of a device that cannot hold a
 * passkey of its own: the challenge only mounts this when it can.
 */
export function PasskeyHereOffer({
  kind,
  device,
  existingNames,
  onDone,
}: {
  /** How the person got through, for the mark above the offer. */
  kind: Exclude<SuccessKind, "passkey">;
  device: DeviceLabel;
  existingNames: string[];
  /** Carry on to where the sign-in was going. */
  onDone: () => void;
}) {
  const t = useTranslations("Auth.twoFactor.passkeyHere");
  const resolve = useResolveMessage();
  const deviceName = useDeviceName();
  const [, setDismissed] = usePasskeyHereDismissed();
  const [phase, setPhase] = React.useState<Phase>("offer");
  const [problem, setProblem] = React.useState<string | null>(null);
  // Bumped on every failure: it keys the fingerprint, so its shake replays.
  const [failures, setFailures] = React.useState(0);

  function fail(message: string) {
    setProblem(message);
    setFailures((count) => count + 1);
    setPhase("offer");
  }

  async function create() {
    setProblem(null);
    setPhase("working");
    const base = deviceName(device);
    const name = suggestedName(existingNames, base, (number) =>
      t("nameNumbered", { name: base, number }),
    );
    const begin = new FormData();
    begin.set("name", name);
    const started = await beginPasskeyHere({}, begin).catch(() => null);
    if (!started?.registration) {
      fail(started?.error ? resolve(started.error.message) : t("failed"));
      return;
    }
    const outcome = await createPasskey(started.registration.options);
    if (!outcome.ok) {
      // Withdraw the half-made factor, as closing the Settings setup does.
      void cancelTwoFactorSetup(started.registration.factorId).catch(() => undefined);
      fail(
        outcome.reason === "cancelled"
          ? t("cancelled")
          : outcome.reason === "exists"
            ? t("exists")
            : t("failed"),
      );
      return;
    }
    const confirm = new FormData();
    confirm.set("credential", outcome.credential);
    const done = await confirmPasskeyHere({}, confirm).catch(() => null);
    if (!done?.done) {
      fail(done?.error ? resolve(done.error.message) : t("failed"));
      return;
    }
    setPhase("added");
  }

  // Answered: remembered here, then on to where the sign-in was going. Only
  // on the way out, because the flag also takes the offer off screen.
  function answered() {
    setDismissed(true);
    onDone();
  }

  if (phase === "added") {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center" data-passkey-here="added">
        <SuccessMark kind="passkey" size="md" />
        <p role="status" className="font-inter text-sm font-medium text-foreground">
          {t("added")}
        </p>
        <Button type="button" onClick={answered} autoFocus className="w-full sm:w-auto">
          {t("continue")}
        </Button>
      </div>
    );
  }

  const busy = phase === "working";
  return (
    <div className="flex flex-col gap-5" data-passkey-here="offer">
      <div className="flex items-center gap-3">
        <SuccessMark kind={kind} size="md" className="mx-0" />
        <p role="status" className="font-inter text-sm font-medium text-foreground">
          {t("signedIn")}
        </p>
      </div>

      <div className="flex flex-col gap-3 border border-border p-4">
        <p className="font-inter text-sm font-semibold text-foreground">{t("title")}</p>
        <p className={helpTextClass}>{t("body")}</p>
        <Button type="button" onClick={create} disabled={busy} autoFocus suppressHydrationWarning>
          <AnimatedFingerprint
            key={failures}
            state={busy ? "scanning" : failures > 0 ? "error" : "idle"}
          />
          {busy ? t("creating") : t("create")}
        </Button>
        {problem && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem}
          </p>
        )}
      </div>

      <Button type="button" variant="ghost" onClick={answered} disabled={busy}>
        {t("notNow")}
      </Button>
    </div>
  );
}
