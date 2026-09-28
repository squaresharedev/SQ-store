"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Mail, Phone } from "lucide-react";
import { SaveButton } from "@/components/ui/SaveButton";
import { OneTimeCodeInput } from "@/components/auth/OneTimeCodeInput";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { helpTextClass } from "@/components/ui/control-styles";
import { badgeClass, iconTileClass } from "@/components/ui/surface-styles";
import { confirmContactCode, sendContactCode } from "@/lib/contact-verification/actions";
import {
  CONTACT_CODE_LENGTH,
  type ContactChannel,
} from "@/lib/contact-verification/policy";
import type { ActionState } from "@/lib/errors";
import { cn } from "@/lib/utils";

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const INITIAL: ActionState = {};

const CHANNEL_ICONS = { email: Mail, phone: Phone } as const;

/**
 * Where one contact detail stands, in the order that decides what is shown.
 * `dirty` wins over everything: an edit in progress is not the value any proof
 * or code belongs to, and saying "confirmed" beside it would be wrong the
 * moment the seller types.
 */
type ProofState = "dirty" | "confirmed" | "unavailable" | "awaitingCode" | "unconfirmed";

/**
 * PROVING ONE CONTACT DETAIL: the seller asks for a code, it goes to the
 * stored email or phone, and they type it back here. Used for the contact
 * email and the phone in Settings › Business & seller details, and for the
 * email in the welcome flow.
 *
 * A code rather than a link on purpose: a link can be opened by a mail
 * scanner, or by whoever really owns an address typed by mistake, without the
 * seller ever seeing it. A code only counts when it is typed into THIS
 * signed-in session (lib/contact-verification).
 *
 * Its forms are its own, so it must be rendered OUTSIDE any other form (a
 * form inside a form is invalid HTML, and browsers drop one of them).
 */
export function ContactVerification({
  channel,
  target,
  verified,
  available,
  codePending = false,
  dirty = false,
  sendAction = sendContactCode,
  confirmAction = confirmContactCode,
  onConfirmed,
  className,
}: {
  channel: ContactChannel;
  /** The SAVED value, as shown to the seller. The code goes here, never to an edit. */
  target: string;
  /** The saved value is already proven. */
  verified: boolean;
  /** A code for this channel can be sent from this deployment. */
  available: boolean;
  /** A live code is already waiting (server-read), so open on the code box. */
  codePending?: boolean;
  /** The field on screen differs from the saved value. */
  dirty?: boolean;
  /** Injectable for the dev gallery and tests; production uses the real actions. */
  sendAction?: FormAction;
  confirmAction?: FormAction;
  /** Runs once the code is accepted, after the page data is refreshed. */
  onConfirmed?: () => void;
  className?: string;
}) {
  const t = useTranslations("Settings.contactVerification");
  const tCommon = useTranslations("Common.actions");
  const tErrors = useTranslations("Errors.contactVerification");
  const router = useRouter();
  const statusId = useId();
  const codeId = useId();

  const [sendState, sendFormAction, sendPending] = useActionState(sendAction, INITIAL);
  const [confirmState, confirmFormAction, confirmPending] = useActionState(
    confirmAction,
    INITIAL,
  );
  useActionStateToast(sendState);
  useActionStateToast(confirmState);
  const sendResult = useSaveResult(sendState);
  const confirmResult = useSaveResult(confirmState);

  // A send that landed opens the code box; a confirm that landed closes the
  // whole thing. Adjusted during render against the state objects, so each
  // result is handled exactly once.
  const [codeRequested, setCodeRequested] = useState(false);
  const [confirmedHere, setConfirmedHere] = useState(false);
  const [handledSend, setHandledSend] = useState(sendState);
  if (sendState !== handledSend) {
    setHandledSend(sendState);
    if (sendState.success) setCodeRequested(true);
  }
  const [handledConfirm, setHandledConfirm] = useState(confirmState);
  if (confirmState !== handledConfirm) {
    setHandledConfirm(confirmState);
    if (confirmState.success) setConfirmedHere(true);
  }

  // The proof changes the gate (banners, checklist) and what buyers see, all
  // rendered on the server: ask for fresh data, then tell the caller.
  useEffect(() => {
    if (!confirmedHere) return;
    router.refresh();
    onConfirmed?.();
  }, [confirmedHere, router, onConfirmed]);

  const state: ProofState = dirty
    ? "dirty"
    : verified || confirmedHere
      ? "confirmed"
      : !available
        ? "unavailable"
        : codePending || codeRequested
          ? "awaitingCode"
          : "unconfirmed";

  const Icon = CHANNEL_ICONS[channel];
  const status = {
    dirty: t("status.dirty", { channel }),
    confirmed: t("status.confirmed"),
    unavailable:
      channel === "phone" ? t("status.phoneUnavailable") : tErrors("unavailable", { channel }),
    awaitingCode: t("enterCode", { channel, length: CONTACT_CODE_LENGTH, target }),
    unconfirmed:
      channel === "email" ? t("status.emailUnconfirmed") : t("status.phoneUnconfirmed"),
  }[state];

  const sendForm = (label: string, variant: "secondary" | "ghost") => (
    <form action={sendFormAction}>
      <input type="hidden" name="channel" value={channel} />
      <SaveButton
        variant={variant}
        pending={sendPending}
        state={sendResult}
        pendingLabel={tCommon("sending")}
        savedLabel={tCommon("sent")}
      >
        {label}
      </SaveButton>
    </form>
  );

  return (
    <div
      className={cn("flex gap-3", className)}
      data-contact-verification={channel}
      data-proof-state={state}
    >
      <span className={cn(iconTileClass, "size-9")}>
        <Icon className="size-4" strokeWidth={2} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-foreground">{t(`channel.${channel}`)}</p>
          {state === "confirmed" && (
            <span className={cn(badgeClass, "inline-flex items-center gap-1 text-success")}>
              <Check className="size-3" strokeWidth={2.5} aria-hidden />
              {t("badge")}
            </span>
          )}
        </div>
        <p className="break-words font-inter text-sm text-foreground">{target}</p>
        <p id={statusId} className={helpTextClass}>
          {status}
        </p>

        {state === "unconfirmed" && sendForm(t("sendCode"), "secondary")}

        {state === "awaitingCode" && (
          <div className="space-y-2">
            <form action={confirmFormAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="channel" value={channel} />
              <label htmlFor={codeId} className="sr-only">
                {t("codeLabel")}
              </label>
              <OneTimeCodeInput
                id={codeId}
                name="code"
                length={CONTACT_CODE_LENGTH}
                submitOnComplete
                aria-describedby={statusId}
                disabled={confirmPending}
                className="w-44"
              />
              <SaveButton
                pending={confirmPending}
                state={confirmResult}
                pendingLabel={t("confirming")}
              >
                {tCommon("confirm")}
              </SaveButton>
            </form>
            {sendForm(t("resend"), "ghost")}
          </div>
        )}
      </div>
    </div>
  );
}
