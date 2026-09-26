"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, Scale } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button, buttonClassName } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/Toast";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { errorTextClass, helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { msg, type MessageRef } from "@/i18n/types";
import { fileModerationAppeal } from "@/lib/moderation/appeals";
import { formatTakedownDate } from "@/lib/moderation/removal";
import { moderationStatementPath } from "@/lib/moderation/paths";
import { APPEAL_MESSAGE_MAX, APPEAL_MESSAGE_MIN } from "@/lib/validation/moderation";
import type { ModerationAppealSummary } from "@/types/product";

/**
 * What a seller can do with a decision itself, beside fixing the content:
 * keep its statement of reasons (a PDF download), and appeal it.
 *
 * WHY THE APPEAL IS IN THE PRODUCT, NOT BY EMAIL. The banner used to offer a pre-addressed
 * mailto. That works until the seller's mail client is not set up, and it
 * leaves the appeal somewhere staff cannot see beside the decision it argues
 * with. EU Digital Services Act Art. 20 asks for an internal, electronic,
 * free complaint route decided by a person; this is it, and the answer comes
 * back here and by email (the admin panel's decideAppeal).
 *
 * ONE APPEAL PER DECISION. Once filed, the button becomes the appeal's status,
 * the way "I've made the changes" becomes a sentence: the seller needs to know
 * it is with a person, not that a button went grey. An UPHELD appeal shows the
 * answer and offers nothing more for this decision; an overturned one never
 * shows at all, because the content is live and the banner is gone.
 *
 * The server half (lib/moderation/appeals.ts) re-checks everything: that the
 * decision is this store's, still in force, and not already appealed.
 */
export function DecisionActions({
  decisionId,
  appeal,
  canAppeal,
}: {
  decisionId: string;
  appeal: ModerationAppealSummary | null | undefined;
  /** False for a read-only team role: the banner already says who can act. */
  canAppeal: boolean;
}) {
  const t = useTranslations("Products.removal");
  const locale = useLocale();
  // Local, so a filed appeal shows the moment the action answers rather than
  // after the refresh that follows it.
  const [filed, setFiled] = useState<ModerationAppealSummary | null>(appeal ?? null);
  const upheld = filed?.status === "upheld";
  const at = filed ? (upheld && filed.decidedAt ? filed.decidedAt : filed.filedAt) : null;

  return (
    <div className="flex flex-col gap-3" data-decision-actions="">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={moderationStatementPath(decisionId)}
          download
          className={buttonClassName("secondary")}
          data-statement-download=""
        >
          <Download className="size-4" strokeWidth={2} aria-hidden="true" />
          {t("downloadStatement")}
        </a>
        {!filed && canAppeal && <AppealForm decisionId={decisionId} onFiled={setFiled} />}
      </div>

      {filed && at && (
        <div role="status" className="flex flex-col gap-1" data-appeal-status={filed.status}>
          <p className={helpTextClass}>
            {t.rich(upheld ? "appealStatus.upheld" : "appealStatus.open", {
              date: formatTakedownDate(at, locale),
              time: (chunks) => <time dateTime={at}>{chunks}</time>,
            })}
          </p>
          {upheld && filed.note && (
            <p className="whitespace-pre-line font-inter text-sm text-foreground">
              {t("appealStatus.answer", { note: filed.note })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AppealForm({
  decisionId,
  onFiled,
}: {
  decisionId: string;
  onFiled: (appeal: ModerationAppealSummary) => void;
}) {
  const t = useTranslations("Products.removal");
  const tForm = useTranslations("Products.removal.appealForm");
  const tCommon = useTranslations("Common.actions");
  const resolve = useResolveMessage();
  const toast = useToast();
  const router = useRouter();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ message: MessageRef; fix?: MessageRef } | null>(null);

  const length = message.trim().length;
  const ready = length >= APPEAL_MESSAGE_MIN && length <= APPEAL_MESSAGE_MAX;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await fileModerationAppeal(decisionId, message).catch(() => null);
      if (!result) {
        setError({ message: msg("Errors.serverError.fileAppeal"), fix: msg("Errors.serverError.fix") });
        return;
      }
      if (!result.ok) {
        setError({ message: result.error.message, fix: result.error.fix });
        return;
      }
      setOpen(false);
      onFiled(result.appeal);
      toast.success(tForm("sent"));
      // The server revalidated the page; this pulls the fresh render so the
      // rest of the banner agrees with the status shown above.
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        data-appeal-open=""
      >
        <Scale className="size-4" strokeWidth={2} aria-hidden="true" />
        {t("appealButton")}
      </Button>

      <Modal
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title={tForm("title")}
        description={tForm("description")}
      >
        <form onSubmit={submit} className="flex flex-col gap-4" data-appeal-form="">
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>{tForm("label")}</Label>
            <Textarea
              id={fieldId}
              name="message"
              rows={6}
              maxLength={APPEAL_MESSAGE_MAX}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={tForm("placeholder")}
              aria-describedby={`${fieldId}-help`}
              required
            />
            <div className="flex items-start justify-between gap-3">
              <p id={`${fieldId}-help`} className={infoTextClass}>
                {tForm("help", { min: APPEAL_MESSAGE_MIN })}
              </p>
              <p className={`${infoTextClass} shrink-0 tabular-nums`} aria-hidden="true">
                {tForm("count", { count: length, max: APPEAL_MESSAGE_MAX })}
              </p>
            </div>
          </div>

          {error && (
            <p role="alert" className={errorTextClass}>
              {resolve(error.message)}
              {error.fix ? ` ${resolve(error.fix)}` : ""}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={!ready || pending} data-appeal-submit="">
              {pending ? tCommon("sending") : tForm("submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
