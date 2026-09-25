"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { errorTextClass, helpTextClass } from "@/components/ui/control-styles";
import { msg, type MessageRef } from "@/i18n/types";
import {
  requestModerationReview,
  type ReviewRequestTarget,
} from "@/lib/moderation/review-request";
import { formatTakedownDate } from "@/lib/moderation/removal";

/**
 * "I've made the changes": the one thing a seller can do about a pause.
 *
 * Once pressed it turns into a sentence rather than a disabled button. A
 * greyed-out button reads as "you cannot do this", when what the seller needs
 * to know is that they already did and it is now with a person.
 *
 * The server half (lib/moderation/review-request.ts) re-checks everything this
 * component assumes: that the item is still paused, that this person may edit
 * it, and that nothing was already requested.
 */
export function ReviewRequestButton({
  kind,
  id,
  requestedAt,
}: {
  kind: ReviewRequestTarget;
  id: string;
  requestedAt: string | null;
}) {
  const t = useTranslations("Products.removal.reviewRequest");
  const tCommon = useTranslations("Common.actions");
  const locale = useLocale();
  const resolve = useResolveMessage();
  const [pending, startTransition] = useTransition();
  const [sentAt, setSentAt] = useState<string | null>(requestedAt);
  const [error, setError] = useState<{ message: MessageRef; fix?: MessageRef } | null>(null);

  if (sentAt) {
    return (
      <p role="status" className={helpTextClass} data-review-requested="">
        {t.rich("sent", {
          date: formatTakedownDate(sentAt, locale),
          time: (chunks) => <time dateTime={sentAt}>{chunks}</time>,
        })}
      </p>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await requestModerationReview(kind, id).catch(() => null);
      if (!result) {
        setError({
          message: msg("Products.removal.reviewRequest.failed"),
          fix: msg("Products.removal.reviewRequest.failedFix"),
        });
        return;
      }
      if (!result.ok) {
        setError({ message: result.error.message, fix: result.error.fix });
        return;
      }
      setSentAt(result.requestedAt);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={submit} disabled={pending} data-review-request="">
        {pending ? tCommon("sending") : t("button")}
      </Button>
      {error && (
        <p role="alert" className={errorTextClass}>
          {resolve(error.message)}
          {error.fix ? ` ${resolve(error.fix)}` : ""}
        </p>
      )}
    </div>
  );
}
