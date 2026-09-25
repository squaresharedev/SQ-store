import type { ReactNode } from "react";
import { PauseCircle, ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { MessageRef } from "@/i18n/types";
import { formatLongDate } from "@/lib/format/date";
import { removalAppealHref, removalFinding } from "@/lib/moderation/removal";
import type { ProductRemoval } from "@/types/product";
import { ReviewRequestButton } from "./ReviewRequestButton";

/**
 * THE STATEMENT OF REASONS, as the seller reads it.
 *
 * WHY THIS IS A BANNER AND NOT A TOAST. Something of theirs has been taken
 * down and is no longer earning. That is not a transient event to acknowledge
 * and dismiss: it persists until they act on it, so the notice persists too.
 * The notification in the bell (and the email) is the ALERT; this is the
 * RECORD, and a seller who comes back a week later still finds it.
 *
 * TWO SHAPES, because staff chose one of two outcomes and they ask opposite
 * things of the seller:
 *
 *   paused   "fix this, then tell us". The reason is framed as what to
 *            change, and the banner carries the button that sends it back to
 *            a person. Neutral, not red: nothing is lost yet, and a red box
 *            reads as a verdict when this is a request.
 *   removed  "this is final". Red, no button, and an appeal link, because a
 *            removal notice missing a way to argue is a verdict rather than a
 *            decision (EU Digital Services Act, Art. 17 and Art. 20).
 *
 * Both say what happened, when, the platform's finding in plain words and
 * whatever the reviewer added. None of that is optional.
 */
export function RemovalNotice({
  removal,
  kind,
  id,
  title,
  canRequestReview = true,
  className,
}: {
  removal: ProductRemoval;
  kind: "product" | "storefront";
  id: string;
  title: string;
  /** False for a read-only team role: they can see why, not act on it. The
   *  server refuses them either way. */
  canRequestReview?: boolean;
  className?: string;
}) {
  const t = useTranslations("Products.removal");
  const tAll = useTranslations();
  const locale = useLocale();
  const resolve = (ref: MessageRef) => tAll(ref.key, ref.values);
  const paused = removal.kind === "paused";
  const headingId = `takedown-${id}`;
  const appealLink = (chunks: ReactNode) => (
    <a
      className="font-medium text-foreground underline underline-offset-2"
      href={removalAppealHref(kind, id, title, resolve)}
    >
      {chunks}
    </a>
  );

  return (
    <section
      // Not role="alert": this is standing state, not something that just
      // happened, and an alert would re-interrupt a screen reader on every
      // navigation back to the page.
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-3 border-2 p-4",
        paused ? "border-foreground bg-muted" : "border-destructive bg-destructive/5",
        className,
      )}
      data-removal-notice={kind}
      data-takedown={removal.kind}
    >
      <div className="flex items-start gap-3">
        {paused ? (
          <PauseCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
        ) : (
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
        )}
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">
            {paused ? t("titlePaused", { kind }) : t("title", { kind })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {paused ? t("hiddenPaused") : t("hiddenRemoved")}
          </p>
        </div>
      </div>

      <dl className="flex flex-col gap-2 pl-8 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-foreground">
            {paused ? t("whatNeedsToChange") : t("reason")}
          </dt>
          <dd className="text-muted-foreground" data-takedown-reason="">
            {resolve(removalFinding(removal.ground, removal.note))}
          </dd>
        </div>
        {removal.at && (
          <div className="flex flex-col gap-0.5">
            <dt className="font-medium text-foreground">
              {paused ? t("pausedOn") : t("when")}
            </dt>
            <dd className="text-muted-foreground">
              <time dateTime={removal.at}>{formatLongDate(removal.at, locale)}</time>
            </dd>
          </div>
        )}
      </dl>

      {paused ? (
        <div className="flex flex-col gap-3 pl-8">
          {canRequestReview ? (
            <>
              {!removal.reviewRequestedAt && (
                <p className="text-sm text-muted-foreground">{t("fixHint", { kind })}</p>
              )}
              <ReviewRequestButton
                kind={kind}
                id={id}
                requestedAt={removal.reviewRequestedAt}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("readOnlyHint", { kind })}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {t.rich("appealPaused", { link: appealLink })}
          </p>
        </div>
      ) : (
        <p className="pl-8 text-sm text-muted-foreground">
          {t.rich("appealFinal", { link: appealLink })}
        </p>
      )}
    </section>
  );
}

/**
 * The list-card version: a word, not a paragraph.
 *
 * Deliberately says "Paused" or "Removed" and nothing else. A card in a grid
 * has room for a state, not for a reason, and a truncated reason is worse than
 * none: the seller reads half a sentence and fills in the rest themselves. The
 * full statement is one click away on the product itself.
 */
export function RemovalBadge({
  kind,
  className,
}: {
  kind: "paused" | "removed";
  className?: string;
}) {
  const t = useTranslations("Products.removal");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 shadow-sm",
        "font-inter text-xs font-medium",
        kind === "paused"
          ? "bg-foreground text-background"
          : "bg-destructive text-destructive-foreground",
        className,
      )}
      data-removal-badge={kind}
    >
      {kind === "paused" ? t("badgePaused") : t("badge")}
    </span>
  );
}
