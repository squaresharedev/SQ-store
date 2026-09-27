"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { SuccessMark } from "@/components/auth/SuccessMark";
import { useDeviceName } from "@/components/auth/useDeviceName";
import type { DeviceLabel } from "@/lib/auth/device-label";
import { PASSWORD_SETTINGS_PATH } from "@/lib/auth/paths";
import {
  decideSignInApproval,
  type DecideApprovalState,
} from "@/lib/auth/sign-in-approval-actions";

const INITIAL: DecideApprovalState = {};

/**
 * The phone's half of sign-in approval: who is asking (a browser, a system, a
 * country, the account), a plain warning, and Approve or Deny. Approving lets
 * the waiting device finish signing in by itself; there is nothing to type or
 * carry back. Denying says what it means: someone has the password.
 */
export function ApproveSignIn({
  token,
  email,
  device,
  location,
}: {
  token: string;
  email: string;
  device: DeviceLabel;
  /** The country the request came from, in the reader's language, if known. */
  location: string | null;
}) {
  const t = useTranslations("Auth.approve");
  const resolve = useResolveMessage();
  const deviceName = useDeviceName();
  const [state, formAction, isPending] = useActionState(decideSignInApproval, INITIAL);
  // Which button was pressed, for its own "working" label.
  const [choice, setChoice] = React.useState<"approve" | "deny" | null>(null);

  if (state.decided === "approve") {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center" data-approve-state="approved">
        <SuccessMark kind="device" size="md" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("approved.heading")}</h1>
        <p role="status" className={helpTextClass}>
          {t("approved.body")}
        </p>
      </div>
    );
  }

  if (state.decided === "deny") {
    return (
      <div className="flex flex-col gap-5" data-approve-state="denied">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("denied.heading")}</h1>
          <p role="status" className={`${helpTextClass} mt-1`}>
            {t("denied.body")}
          </p>
        </div>
        <Link href={PASSWORD_SETTINGS_PATH} className={buttonClassName("primary", "w-full")}>
          {t("denied.changePassword")}
        </Link>
      </div>
    );
  }

  const strong = (chunks: React.ReactNode) => (
    <span className="font-medium text-foreground">{chunks}</span>
  );

  return (
    <form action={formAction} className="flex flex-col gap-5" data-approve-state="open">
      <input type="hidden" name="token" value={token} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("heading")}</h1>
        <p className={`${helpTextClass} mt-1`}>
          {email ? t.rich("introAs", { email, strong }) : t("intro")}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y border-border py-3 font-inter text-sm">
        <dt className="text-muted-foreground">{t("device")}</dt>
        <dd className="font-medium text-foreground" data-approve-device>
          {deviceName(device)}
        </dd>
        <dt className="text-muted-foreground">{t("location")}</dt>
        <dd className="font-medium text-foreground">{location ?? t("locationUnknown")}</dd>
      </dl>

      <p className={`${infoTextClass} flex items-start gap-2`}>
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
        <span>{t("warning")}</span>
      </p>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {resolve(state.error.message)}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          name="decision"
          value="approve"
          disabled={isPending}
          onClick={() => setChoice("approve")}
          className="w-full px-8 py-3.5 text-base"
          suppressHydrationWarning
        >
          {isPending && choice === "approve" ? (
            <>
              <Spinner />
              {t("approving")}
            </>
          ) : (
            t("approve")
          )}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="deny"
          variant="ghost"
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
      </div>
    </form>
  );
}
