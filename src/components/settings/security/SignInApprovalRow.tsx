"use client";

import * as React from "react";
import { useActionState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HeroMark } from "@/components/ui/HeroMark";
import { useActionStateToast, useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { infoTextClass } from "@/components/ui/control-styles";
import { StepUpPrompt, StepUpScope, StepUpSubmit } from "@/components/auth/StepUp";
import { setSignInApproval } from "@/lib/auth/sign-in-approval-actions";
import type { ActionState } from "@/lib/errors";
import { FORM_UNREACHABLE, resilientAction } from "@/lib/resilient-action";
import { cn } from "@/lib/utils";

const INITIAL: ActionState = {};

// On or off is the same answer however often it is sent (lib/resilient-action.ts).
const save = resilientAction(setSignInApproval, FORM_UNREACHABLE);

/**
 * Sign-in approval, as one of the account's ways through 2FA: "approve from a
 * signed-in device" (lib/auth/sign-in-approval.ts). On unless switched off
 * for an account with an authenticator app; OFF until asked for when the only
 * ways in are passkeys, since approving is weaker than a passkey on its own.
 * Shown under the passkeys and apps it sits beside, because it changes who
 * can let a new sign-in through, and switching it either way takes a recent
 * second factor like any other sensitive setting.
 */
export function SignInApprovalRow({
  enabled,
  offByDefault = false,
}: {
  enabled: boolean;
  /** This account's default is off (passkeys only), so say why it is. */
  offByDefault?: boolean;
}) {
  const t = useTranslations("Settings.security.approvals");
  const [confirming, setConfirming] = React.useState(false);
  const close = React.useCallback(() => setConfirming(false), []);

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3"
      data-sign-in-approval={enabled ? "on" : "off"}
    >
      {/* Grows, so the button keeps to the right like the factor rows' Remove,
          and only drops below on a narrow screen. */}
      <div className="flex min-w-0 flex-1 basis-60 items-start gap-2.5">
        <MonitorSmartphone aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-inter text-sm font-medium text-foreground">
            {t("title")}
            <span
              className={cn(
                "border px-1.5 py-0.5 text-xs font-semibold leading-none",
                enabled ? "border-foreground text-foreground" : "border-border text-muted-foreground",
              )}
            >
              {enabled ? t("statusOn") : t("statusOff")}
            </span>
          </p>
          <p className={infoTextClass}>{t("description")}</p>
          {!enabled && offByDefault && <p className={infoTextClass}>{t("offByDefault")}</p>}
        </div>
      </div>
      <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
        {enabled ? t("turnOff") : t("turnOn")}
      </Button>
      {confirming && <SwitchModal turningOn={!enabled} onClose={close} />}
    </div>
  );
}

function SwitchModal({ turningOn, onClose }: { turningOn: boolean; onClose: () => void }) {
  const t = useTranslations("Settings.security.approvals");
  const resolve = useResolveMessage();
  const [state, formAction, isPending] = useActionState(save, INITIAL);
  // Success as a toast (the modal closes with it); errors stay inline.
  const announced = React.useMemo<ActionState | undefined>(
    () => (state.success ? { success: state.success } : undefined),
    [state],
  );
  useActionStateToast(announced);

  React.useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    // Asked for only when the last second factor has gone stale, and then in
    // the dialog's own button (auth/StepUp).
    <StepUpScope id="sign-in-approval" state={state}>
      <ConfirmDialog
        open
        onClose={onClose}
        visual={<HeroMark icon={MonitorSmartphone} />}
        title={turningOn ? t("confirmOnTitle") : t("confirmOffTitle")}
        description={turningOn ? t("confirmOnDescription") : t("confirmOffDescription")}
        action={formAction}
        pending={isPending}
        confirmLabel={turningOn ? t("turnOn") : t("turnOff")}
        pendingLabel={t("saving")}
        submitAs={StepUpSubmit}
      >
        <input type="hidden" name="enabled" value={turningOn ? "on" : "off"} />
        <StepUpPrompt />
        {state.error && (
          <p role="alert" className="font-inter text-sm font-medium text-destructive">
            {resolve(state.error.message)}
          </p>
        )}
      </ConfirmDialog>
    </StepUpScope>
  );
}
