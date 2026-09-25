"use client";

import * as React from "react";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { StepUpField } from "@/components/auth/StepUp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelAccountDeletion,
  requestAccountDeletion,
} from "@/lib/settings/actions";
import {
  DELETE_CONFIRM_PHRASES,
  isDeleteConfirmPhrase,
} from "@/lib/settings/constants";
import type { ActionState } from "@/lib/errors";
import { formatLongDate } from "@/lib/format/date";

const INITIAL: ActionState = {};

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
  const t = useTranslations("Settings.danger.delete");
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
  const locale = useLocale();
  const confirmPhrase = DELETE_CONFIRM_PHRASES[locale];
  // The server names the default language's phrase; this form knows the one
  // it is showing.
  const phraseValues = React.useMemo(() => ({ phrase: confirmPhrase }), [confirmPhrase]);
  useActionStateToast(deleteState, { values: phraseValues });
  useActionStateToast(cancelState);
  const deleteResult = useSaveResult(deleteState);
  const cancelResult = useSaveResult(cancelState);

  if (deletionRequestedAt) {
    return (
      <SettingsCard
        title={t("requestedTitle")}
        description={t("requestedDescription", {
          date: formatLongDate(deletionRequestedAt, locale),
        })}
        danger
      >
        <form action={cancelAction} className="flex flex-col gap-4">
          <div>
            <SaveButton
              variant="secondary"
              pending={cancelPending}
              state={cancelResult}
              pendingLabel={t("cancelling")}
            >
              {t("keepButton")}
            </SaveButton>
          </div>
        </form>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      danger
    >
      {!armed ? (
        <Button variant="destructive" onClick={() => setArmed(true)}>
          {t("deleteButton")}
        </Button>
      ) : (
        <form action={deleteAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm" className="text-destructive">
              {t.rich("confirmLabel", {
                phrase: confirmPhrase,
                code: (chunks) => (
                  <span className="font-mono text-xs">{chunks}</span>
                ),
              })}
            </Label>
            <Input
              id="confirm"
              name="confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
          <StepUpField id="delete-account" state={deleteState} />
          <div className="flex flex-wrap items-center gap-3">
            <SaveButton
              variant="destructive"
              pending={deletePending}
              state={deleteResult}
              pendingLabel={t("flagging")}
              disabled={
                deletePending ||
                !isDeleteConfirmPhrase(phrase)
              }
            >
              {t("permanentlyDelete")}
            </SaveButton>
            <Button
              variant="ghost"
              onClick={() => {
                setArmed(false);
                setPhrase("");
              }}
            >
              {t("neverMind")}
            </Button>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}
