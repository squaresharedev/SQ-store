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
import { helpTextClass } from "@/components/ui/control-styles";
import { ACCOUNT_DELETION_GRACE_DAYS, ORDER_AFTERCARE_DAYS } from "@/lib/account-deletion/policy";
import type { DeletionStatus } from "@/lib/account-deletion/requests";

const INITIAL: ActionState = {};

/**
 * Deliberate, two-step deletion: reveal, then type-to-confirm. Submitting
 * records a REQUEST. The deletion itself is a scheduled job
 * (lib/account-deletion/run.ts) that runs after the waiting period, once
 * nothing is owed to a buyer.
 *
 * With a request standing, the card says what will happen and when: the date,
 * anything the seller's orders are holding it for, and the way to undo it
 * (until the job has begun, after which there is none).
 */
export function DeleteAccountForm({
  deletion,
}: {
  deletion: DeletionStatus | null;
}) {
  const t = useTranslations("Settings.danger.delete");
  const [armed, setArmed] = React.useState(false);
  const [phrase, setPhrase] = React.useState("");
  // Once a request stands, the confirmation that made it is spent. Without
  // this, "Keep my account" would hand back a form still armed and still
  // holding the typed phrase: one press away from asking all over again.
  const requested = deletion !== null;
  const [wasRequested, setWasRequested] = React.useState(requested);
  if (requested !== wasRequested) {
    setWasRequested(requested);
    if (requested) {
      setArmed(false);
      setPhrase("");
    }
  }
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

  if (deletion?.started) {
    return (
      <SettingsCard title={t("requestedTitle")} description={t("started")} danger>
        {null}
      </SettingsCard>
    );
  }

  if (deletion) {
    return (
      <SettingsCard
        title={t("requestedTitle")}
        description={t("requestedDescription", {
          date: formatLongDate(deletion.requestedAt, locale),
          deleteOn: formatLongDate(deletion.deleteOn, locale),
        })}
        danger
      >
        {/* What the seller's own orders are holding it for, so a date that
            passes without a deletion is not a mystery. */}
        {deletion.holds.length > 0 && (
          <div className="mb-4 flex flex-col gap-1" data-deletion-holds={deletion.holds.join(" ")}>
            <p className="text-sm font-medium text-foreground">{t("holdsTitle")}</p>
            <ul className={helpTextClass}>
              {deletion.holds.map((hold) => (
                <li key={hold}>
                  {hold === "recentSale"
                    ? t("holds.recentSale", {
                        date: formatLongDate(deletion.aftercareEndsOn ?? deletion.deleteOn, locale),
                        days: ORDER_AFTERCARE_DAYS,
                      })
                    : t(`holds.${hold}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
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
      description={t("description", { days: ACCOUNT_DELETION_GRACE_DAYS })}
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
