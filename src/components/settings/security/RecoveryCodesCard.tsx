"use client";

import * as React from "react";
import { useActionState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
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
  const tCommon = useTranslations("Common.actions");
  const resolve = useResolveMessage();
  const [state, formAction, isPending] = useActionState(regenerateRecoveryCodes, INITIAL);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={state.codes ? t("recoveryCodes.newTitle") : t("recoveryCodes.regenerateTitle")}
      description={
        state.codes
          ? t("recoveryCodes.newDescription")
          : t("recoveryCodes.regenerateDescription")
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
            description={t("stepUpConfirm")}
          />
          {state.error && (
            <p role="alert" className="font-inter text-sm font-medium text-destructive">
              {resolve(state.error.message)}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={isPending} suppressHydrationWarning>
              {isPending ? (
                <>
                  <Spinner />
                  {t("recoveryCodes.generating")}
                </>
              ) : (
                t("recoveryCodes.generate")
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
