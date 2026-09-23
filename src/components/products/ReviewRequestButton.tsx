"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { errorTextClass, helpTextClass } from "@/components/ui/control-styles";
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
  const [pending, startTransition] = useTransition();
  const [sentAt, setSentAt] = useState<string | null>(requestedAt);
  const [error, setError] = useState<{ message: string; fix?: string } | null>(null);

  if (sentAt) {
    return (
      <p role="status" className={helpTextClass} data-review-requested="">
        Sent for review on{" "}
        <time dateTime={sentAt}>{formatTakedownDate(sentAt)}</time>. A person
        will look at your changes, and you will hear back here and by email.
      </p>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await requestModerationReview(kind, id).catch(() => null);
      if (!result) {
        setError({ message: "That could not be sent.", fix: "Try again in a moment." });
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
        {pending ? "Sending…" : "I've made the changes, review it"}
      </Button>
      {error && (
        <p role="alert" className={errorTextClass}>
          {error.message}
          {error.fix ? ` ${error.fix}` : ""}
        </p>
      )}
    </div>
  );
}
