import type { ReactNode } from "react";
import Link from "next/link";
import { PauseCircle, PencilRuler, ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { MessageRef } from "@/i18n/types";
import { formatLongDate } from "@/lib/format/date";
import {
  REMOVAL_APPEAL_EMAIL,
  decisionReference,
  removalFinding,
} from "@/lib/moderation/removal";
import { moderationNoticeId } from "@/lib/moderation/paths";
import { storefrontEditorPath } from "@/lib/storefront/paths";
import { buttonClassName } from "@/components/ui/button";
import type { ProductRemoval } from "@/types/product";
import { DecisionActions } from "./DecisionActions";
import { FixFieldChips } from "./FixFieldChips";
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
 *   paused   "fix this, then tell us". It leads with WHAT to change, as chips
 *            that jump to the matching part of the form (which is lit up the
 *            same way), then why, then the button that sends it back to a
 *            person. Neutral, not red: nothing is lost yet, and a red box
 *            reads as a verdict when this is a request.
 *   removed  "this is final". Red, no fix button.
 *
 * BOTH carry the decision's reference, a download of the full statement (EU
 * Digital Services Act Art. 17) and a way to appeal it in-app (Art. 20), once
 * the decision has a record (every decision since the decisions table; older
 * takedowns fall back to a plain "write to us").
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
  const fields = removal.fields;
  const mailLink = (chunks: ReactNode) => (
    <a
      className="font-medium text-foreground underline underline-offset-2"
      href={`mailto:${REMOVAL_APPEAL_EMAIL}`}
    >
      {chunks}
    </a>
  );

  return (
    <section
      id={moderationNoticeId(id)}
      // Not role="alert": this is standing state, not something that just
      // happened, and an alert would re-interrupt a screen reader on every
      // navigation back to the page.
      aria-labelledby={headingId}
      className={cn(
        "flex scroll-mt-20 flex-col gap-3 border-2 p-4",
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
          {/* The item's own name, so a list of several banners says which is
              which. Visible text rather than only a label: on the storefront
              list there can be more than one. */}
          <p id={`${headingId}-title`} className="text-sm font-medium text-foreground">
            {title}
          </p>
          <p className="text-sm text-muted-foreground">
            {paused ? t("hiddenPaused") : t("hiddenRemoved")}
          </p>
        </div>
      </div>

      <dl className="flex flex-col gap-3 pl-8 text-sm">
        {fields.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <dt className="font-medium text-foreground">
              {paused ? t("whatToChange") : t("concerned")}
            </dt>
            <dd>
              <FixFieldChips
                target={kind}
                fields={fields}
                // Only where the parts are on this page: a paused product's
                // own edit form. The storefront's are in its editor.
                interactive={paused && kind === "product"}
              />
            </dd>
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-foreground">
            {fields.length > 0 ? t("why") : paused ? t("whatNeedsToChange") : t("reason")}
          </dt>
          <dd className="whitespace-pre-line text-muted-foreground" data-takedown-reason="">
            {resolve(removalFinding(removal.ground, removal.note))}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
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
          {removal.decisionId && (
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium text-foreground">{t("reference")}</dt>
              <dd className="font-mono text-muted-foreground" data-decision-reference="">
                {decisionReference(removal.decisionId)}
              </dd>
            </div>
          )}
        </div>
      </dl>

      {paused && (
        <div className="flex flex-col gap-3 pl-8">
          {canRequestReview ? (
            <>
              {!removal.reviewRequestedAt && (
                <p className="text-sm text-muted-foreground">{t("fixHint", { kind })}</p>
              )}
              {/* The storefront's parts live in its editor, one click away. */}
              {kind === "storefront" && !removal.reviewRequestedAt && (
                <Link
                  href={storefrontEditorPath(id)}
                  className={buttonClassName("secondary", "w-fit")}
                  data-open-editor=""
                >
                  <PencilRuler className="size-4" strokeWidth={2} aria-hidden="true" />
                  {t("openEditor")}
                </Link>
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
        </div>
      )}

      {removal.decisionId ? (
        <div className="border-t border-border pt-3 pl-8">
          <DecisionActions
            decisionId={removal.decisionId}
            appeal={removal.appeal}
            canAppeal={canRequestReview}
          />
        </div>
      ) : (
        <p className="pl-8 text-sm text-muted-foreground">
          {paused
            ? t.rich("appealPaused", { link: mailLink })
            : t.rich("appealFinal", { link: mailLink })}
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
