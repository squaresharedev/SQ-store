"use client";

import * as React from "react";
import { useActionState } from "react";
import { KeyRound, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal } from "@/components/ui/modal";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { helpTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { StepUpPrompt, StepUpScope, StepUpSubmit } from "@/components/auth/StepUp";
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
  const t = useTranslations("Settings.security.recoveryCodes");
  const [open, setOpen] = React.useState(false);
  const low = remaining !== null && remaining <= RECOVERY_CODES_LOW;
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <SettingsCard id="recovery-codes" title={t("cardTitle")} description={t("cardDescription")}>
      <div className="flex flex-col gap-4">
        {remaining === null ? (
          <p className={helpTextClass}>{t("countUnavailable")}</p>
        ) : (
          <p
            className={low ? "flex items-start gap-2 font-inter text-sm text-destructive" : helpTextClass}
            data-recovery-remaining={remaining}
          >
            {low && <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
            <span>
              {t(remaining === 0 ? "remainingNone" : low ? "remainingLow" : "remaining", {
                count: remaining,
                total: RECOVERY_CODE_COUNT,
              })}
            </span>
          </p>
        )}
        <div>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
            <RefreshCw aria-hidden className="size-4" />
            {t("generate")}
          </Button>
        </div>
      </div>

      <RegenerateModal key={open ? "open" : "closed"} open={open} onClose={close} />
    </SettingsCard>
  );
}

function RegenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("Settings.security");
  const resolve = useResolveMessage();
  const [state, formAction, isPending] = useActionState(regenerateRecoveryCodes, INITIAL);

  // The new set, once made: the codes are the dialog, shown once.
  if (state.codes) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t("recoveryCodes.newTitle")}
        description={t("recoveryCodes.newDescription")}
      >
        <RecoveryCodesDisplay codes={state.codes} onDone={onClose} />
      </Modal>
    );
  }

  return (
    // Always confirmed in the same request, and with a passkey that
    // confirmation IS the dialog's button (auth/StepUp).
    <StepUpScope id="regenerate-codes" state={state} always description={t("stepUpConfirm")}>
      <ConfirmDialog
        open={open}
        onClose={onClose}
        visual={<HeroMark icon={KeyRound} badge={RefreshCw} />}
        title={t("recoveryCodes.regenerateTitle")}
        description={t("recoveryCodes.regenerateDescription")}
        action={formAction}
        pending={isPending}
        confirmLabel={t("recoveryCodes.generate")}
        pendingLabel={t("recoveryCodes.generating")}
        submitAs={StepUpSubmit}
      >
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
