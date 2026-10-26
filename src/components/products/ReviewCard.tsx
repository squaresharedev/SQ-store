"use client";

import { Fragment } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Ban, BadgeCheck, Clock, Download, EyeOff, Hourglass, Package } from "lucide-react";
import Link from "@/components/ui/AppLink";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { badgeClass, cardClass } from "@/components/ui/surface-styles";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import { StarRating } from "@/components/product-page/StarRating";
import { paragraphs } from "@/components/product-page/product-page-maps";
import type { Locale } from "@/i18n/locales";
import { formatOrderDate } from "@/lib/format/date";
import { productEditPath } from "@/lib/products/paths";
import type { ReviewModerationStatus, ReviewVisibilityAction } from "@/lib/reviews/moderation-rules";
import type { SellerReview } from "@/types/review";

/** The card's action buttons: compact, so they share a line with the badges. */
const ACTION_BUTTON_CLASS = "px-3 py-1.5";

/** A badge with an icon in front: the review card's labels. */
const iconBadgeClass = cn(badgeClass, "inline-flex items-center gap-1");

/** The automatic check's verdict, as a tinted badge: held asks for the seller, blocked is final. */
const MODERATION_BADGE: Record<Exclude<ReviewModerationStatus, "clean">, { icon: typeof Clock; tone: string }> = {
  pending: { icon: Hourglass, tone: "text-muted-foreground" },
  held: { icon: Clock, tone: "bg-rating/15 text-foreground" },
  blocked: { icon: Ban, tone: "bg-destructive/10 text-destructive" },
};

/** The stripe down a card's left edge, for the reviews that are not simply live. */
function accentClass(review: SellerReview): string | undefined {
  if (review.moderation === "blocked") return "border-l-4 border-l-destructive";
  if (review.moderation === "held") return "border-l-4 border-l-rating";
  if (review.hiddenReason) return "border-l-4 border-l-muted-foreground/40 bg-muted/30";
  return undefined;
}

/** "Hannah K." -> "HK": the avatar's letters. */
function initials(name: string): string {
  const parts = name.replace(/\./g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Characters with a meaning in a regular expression, escaped so a search term matches itself. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `text` with every case-insensitive occurrence of `term` marked, so a seller
 * who searched sees why each review matched.
 */
export function Highlight({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded-sm bg-rating/30 px-0.5 text-foreground" data-review-match="">
            {part}
          </mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * One review on the seller's page: who wrote it and how many stars, what they
 * said, which product it is about, where the check and the seller left it,
 * and the actions the seller may take.
 */
export function ReviewCard({
  review,
  canModerate,
  busy,
  acting,
  search,
  onHide,
  onAct,
}: {
  review: SellerReview;
  canModerate: boolean;
  /** Some review's action is under way: every action waits for it. */
  busy: boolean;
  /** The action under way on THIS review, if any. */
  acting: ReviewVisibilityAction | null;
  /** The search term, to mark where it matched. */
  search?: string;
  onHide: () => void;
  onAct: (action: ReviewVisibilityAction) => void;
}) {
  const t = useTranslations("Products.reviewModeration");
  const tPage = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const hidden = review.hiddenReason !== null;
  // The check's verdict when there is one to show; a clean review shows none.
  const status = review.moderation === "clean" ? null : review.moderation;
  const moderationBadge = status ? MODERATION_BADGE[status] : null;

  return (
    <article
      className={cn(cardClass, "flex gap-3 p-4 @md:gap-4", accentClass(review))}
      data-review={review.id}
      data-review-moderation={review.moderation}
      data-review-hidden={hidden || undefined}
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rating/15 font-inter text-sm font-semibold text-foreground"
      >
        {initials(review.authorName)}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-inter text-sm font-semibold text-foreground">
              <Highlight text={review.authorName} term={search} />
            </span>
            {review.source !== "native" ? (
              <span className={cn(iconBadgeClass, "text-muted-foreground")}>
                <Download aria-hidden="true" className="size-3" />
                {tPage("imported", { source: review.source })}
              </span>
            ) : review.verified ? (
              <span className={cn(iconBadgeClass, "bg-success/10 text-success")}>
                <BadgeCheck aria-hidden="true" className="size-3" />
                {tPage("verified")}
              </span>
            ) : null}
          </p>
          <time dateTime={review.reviewedAt} className="font-inter text-xs text-muted-foreground">
            {formatOrderDate(review.reviewedAt, locale)}
          </time>
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-rating">
            <StarRating value={review.rating} label={tPage("stars", { rating: review.rating })} />
          </span>
          {review.title && (
            <h3 className="font-inter text-sm font-semibold text-foreground">
              <Highlight text={review.title} term={search} />
            </h3>
          )}
        </div>

        {review.body && (
          <div className="flex flex-col gap-2 font-inter text-sm leading-relaxed text-foreground">
            {paragraphs(review.body).map((text, index) => (
              <p key={index} className="whitespace-pre-line">
                <Highlight text={text} term={search} />
              </p>
            ))}
          </div>
        )}

        {/* What it is about and where it stands on the left; what the seller
            can do on the right, on the same line while there is room. */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Link
            href={productEditPath(review.productId)}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 font-inter text-xs font-medium text-foreground hover:bg-accent",
              transitionClass,
              focusRingClass,
            )}
          >
            <Package aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{review.productTitle}</span>
          </Link>
          {status && moderationBadge && (
            <span className={cn(iconBadgeClass, moderationBadge.tone)} data-review-status={status}>
              <moderationBadge.icon aria-hidden="true" className="size-3" />
              {t(`status.${status}`)}
              {review.ground && status !== "pending" ? ` · ${t(`grounds.${review.ground}`)}` : ""}
            </span>
          )}
          {hidden && review.hiddenReason && (
            <span className={cn(iconBadgeClass, "text-muted-foreground")}>
              <EyeOff aria-hidden="true" className="size-3" />
              {t("hiddenBecause", { reason: t(`reasons.${review.hiddenReason}.label`) })}
            </span>
          )}

          {canModerate && (
            <div className="ml-auto flex flex-wrap gap-2">
              {review.moderation === "held" && (
                <Button className={ACTION_BUTTON_CLASS} disabled={busy} pending={acting === "publish"} onClick={() => onAct("publish")}>
                  {t("actions.publish")}
                </Button>
              )}
              {hidden ? (
                <Button variant="secondary" className={ACTION_BUTTON_CLASS} disabled={busy} pending={acting === "show"} onClick={() => onAct("show")}>
                  {t("actions.show")}
                </Button>
              ) : (
                review.moderation !== "blocked" && (
                  <Button variant="secondary" className={ACTION_BUTTON_CLASS} disabled={busy} onClick={onHide}>
                    <EyeOff aria-hidden="true" className="size-4" />
                    {t("actions.hide")}
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
