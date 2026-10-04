"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Monitor, ShieldAlert, ShieldX, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass, labelClass } from "@/components/ui/control-styles";
import { HeroMark } from "@/components/ui/HeroMark";
import { authHeadingClass } from "@/components/ui/surface-styles";
import { AuthNotice } from "@/components/auth/AuthNotice";
import { SuccessMark } from "@/components/auth/SuccessMark";
import { useDeviceName } from "@/components/auth/useDeviceName";
import type { DeviceLabel } from "@/lib/auth/device-label";
import { PASSWORD_SETTINGS_PATH } from "@/lib/auth/paths";
import {
  decideSignInApproval,
  type DecideApprovalState,
} from "@/lib/auth/sign-in-approval-actions";

const INITIAL: DecideApprovalState = {};

/** The systems that are a phone or a tablet (lib/auth/device-label.ts): the
 *  device asking is drawn as one, and as a computer otherwise. */
const HANDHELD_SYSTEMS = new Set(["iOS", "iPadOS", "Android"]);

/**
 * The phone's half of sign-in approval, read top down: WHICH device is asking
 * (drawn, with its browser and system, and its country when known), for which
 * account, then the number shown on that device, picked from three, or Deny.
 * The right number lets the waiting device finish signing in by itself; there
 * is nothing to type or carry back. A wrong one refuses the sign-in, like
 * Deny: someone who talked the owner into scanning cannot see that screen, so
 * a guess must not get through. Denying says what it means: someone has the
 * password.
 *
 * The warning under the numbers is a control, not decoration: it is kept to
 * one line so it is read, and it is never folded away.
 */
export function ApproveSignIn({
  token,
  email,
  device,
  location,
  choices,
}: {
  token: string;
  email: string;
  device: DeviceLabel;
  /** The country the request came from, in the reader's language, if known. */
  location: string | null;
  /** Three numbers, one of them the waiting device's, in random order. */
  choices: number[];
}) {
  const t = useTranslations("Auth.approve");
  const resolve = useResolveMessage();
  const deviceName = useDeviceName();
  const [state, formAction, isPending] = useActionState(decideSignInApproval, INITIAL);
  // Which button was pressed, for its own "working" label.
  const [choice, setChoice] = React.useState<number | "deny" | null>(null);

  if (state.decided === "approve") {
    return (
      <AuthNotice
        visual={<SuccessMark kind="device" size="md" />}
        heading={t("approved.heading")}
        body={t("approved.body")}
        live
        back
        attributes={{ "data-approve-state": "approved" }}
      />
    );
  }

  if (state.decided === "deny" || state.decided === "mismatch") {
    const outcome = state.decided === "deny" ? "denied" : "mismatch";
    return (
      <AuthNotice
        // Denying is the owner's own doing; a wrong number is the alarm.
        visual={
          outcome === "denied" ? (
            <HeroMark icon={ShieldX} />
          ) : (
            <HeroMark icon={ShieldAlert} tone="danger" />
          )
        }
        heading={t(`${outcome}.heading`)}
        body={t(`${outcome}.body`)}
        live
        back
        attributes={{ "data-approve-state": outcome }}
      >
        <Link href={PASSWORD_SETTINGS_PATH} className={buttonClassName("primary", "w-full")}>
          {t("denied.changePassword")}
        </Link>
      </AuthNotice>
    );
  }

  const strong = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );

  return (
    <form action={formAction} className="flex flex-col gap-5" data-approve-state="open">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col items-center gap-3 text-center">
        <HeroMark icon={device.os && HANDHELD_SYSTEMS.has(device.os) ? Smartphone : Monitor} size="lg" />
        <p className="font-inter text-sm font-medium text-foreground">
          <span data-approve-device>{deviceName(device)}</span>
          {location && <span className="text-muted-foreground"> · {location}</span>}
        </p>
        <div>
          <h1 className={authHeadingClass}>{t("heading")}</h1>
          <p className={`${helpTextClass} mt-1`}>
            {email ? t.rich("introAs", { email, strong }) : t("intro")}
          </p>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-center text-sm font-medium text-destructive">
          {resolve(state.error.message)}
        </p>
      )}

      <fieldset className="flex flex-col">
        <legend className={`${labelClass} mb-3 w-full text-balance text-center`}>{t("pickNumber")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {choices.map((number) => (
            <Button
              key={number}
              type="submit"
              name="number"
              value={String(number)}
              variant="secondary"
              disabled={isPending}
              onClick={() => setChoice(number)}
              aria-label={t("numberButton", { number })}
              className="h-20 text-3xl font-semibold tabular-nums"
              data-approve-number={number}
              suppressHydrationWarning
            >
              {isPending && choice === number ? <Spinner /> : number}
            </Button>
          ))}
        </div>
      </fieldset>

      <p className={`${infoTextClass} flex items-start gap-2`}>
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
        <span>{t("warning")}</span>
      </p>

      <Button
        type="submit"
        name="decision"
        value="deny"
        variant="ghost-danger"
        disabled={isPending}
        onClick={() => setChoice("deny")}
        className="w-full"
        suppressHydrationWarning
      >
        {isPending && choice === "deny" ? (
          <>
            <Spinner />
            {t("denying")}
          </>
        ) : (
          t("deny")
        )}
      </Button>
    </form>
  );
}
