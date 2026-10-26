"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/AppLink";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { EyeOff, MessageSquareQuote } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { HeroMark } from "@/components/ui/HeroMark";
import { PageTabs } from "@/components/ui/PageTabs";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { badgeClass, cardClass } from "@/components/ui/surface-styles";
import { errorTextClass, helpTextClass, infoTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { StarRating } from "@/components/product-page/StarRating";
import { paragraphs } from "@/components/product-page/product-page-maps";
import type { Locale } from "@/i18n/locales";
import { formatOrderDate } from "@/lib/format/date";
import { productEditPath } from "@/lib/products/paths";
import { REVIEWS_FILTER_PARAM, REVIEWS_PATH } from "@/lib/reviews/paths";
import { setReviewVisibility } from "@/lib/reviews/actions";
import {
  REVIEW_HIDE_REASONS,
  REVIEW_MODERATION_FILTERS,
  type ReviewHideReason,
  type ReviewModerationFilter,
  type ReviewVisibilityAction,
} from "@/lib/reviews/moderation-rules";
import type { SellerReviewList } from "@/lib/reviews/seller-queries";
import type { SellerReview } from "@/types/review";

/**
 * A store's reviews, and the three things a seller can do to one: hide it for
 * a reason, show it again, publish one the automatic check held.
 *
 * HIDING ASKS WHY, from a closed list, and says why it asks: hiding a review
 * because it is negative misleads buyers, which EU consumer law forbids. The
 * reasons are the ones that are not about the opinion (see
 * lib/reviews/moderation-rules.ts), and there is no free-text "other".
 *
 * A review the check BLOCKED is shown with its reason and no way to publish
 * it: it broke a rule, and that is not the seller's to overrule.
 */

function filterHref(filter: ReviewModerationFilter, page = 1): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set(REVIEWS_FILTER_PARAM, filter);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${REVIEWS_PATH}?${query}` : REVIEWS_PATH;
}

export function ReviewModeration({
  list,
  filter,
  canModerate,
}: {
  /** Null when the read failed. */
  list: SellerReviewList | null;
  filter: ReviewModerationFilter;
  canModerate: boolean;
}) {
  const t = useTranslations("Products.reviewModeration");
  const tPagination = useTranslations("Common.pagination");
  const tActions = useTranslations("Common.actions");
  const router = useRouter();
  const toast = useToast();
  const showActionError = useActionErrorToast();
  const [pending, startTransition] = useTransition();
  // Which review and action is under way, so the clicked button (not every
  // button on the page) carries the spinner.
  const [acting, setActing] = useState<{ id: string; action: ReviewVisibilityAction } | null>(null);
  const [hiding, setHiding] = useState<SellerReview | null>(null);
  const [reason, setReason] = useState<ReviewHideReason | null>(null);

  function act(review: SellerReview, action: ReviewVisibilityAction, hideReason: ReviewHideReason | null = null) {
    setActing({ id: review.id, action });
    startTransition(async () => {
      try {
        const result = await setReviewVisibility(review.id, action, hideReason);
        if (!result.ok) {
          showActionError(result.error);
          return;
        }
        toast.success(t(`done.${action}`));
        setHiding(null);
        setReason(null);
        router.refresh();
      } finally {
        setActing(null);
      }
    });
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <PageTabs
        ariaLabel={t("filtersLabel")}
        tabs={REVIEW_MODERATION_FILTERS.map((value) => ({
          href: filterHref(value),
          label: t(`filters.${value}`),
          active: value === filter,
          ...(value === "held" && list && list.held > 0
            ? { count: list.held, countLabel: t("heldCount", { count: list.held }) }
            : {}),
        }))}
      />

      {!list ? (
        <p className={errorTextClass} role="alert">
          {t("loadFailed")}
        </p>
      ) : list.rows.length === 0 ? (
        <div className={cn(cardClass, "flex flex-col items-center gap-3 px-6 py-10 text-center")} data-reviews-empty="">
          <HeroMark icon={MessageSquareQuote} />
          <p className="font-inter text-sm font-medium text-foreground">{t(`empty.${filter}.title`)}</p>
          <p className={helpTextClass}>{t(`empty.${filter}.body`)}</p>
        </div>
      ) : (
        <ul className="space-y-3" data-reviews-list="">
          {list.rows.map((review) => (
            <li key={review.id}>
              <ReviewCard
                review={review}
                canModerate={canModerate}
                busy={pending}
                acting={acting?.id === review.id ? acting.action : null}
                onHide={() => setHiding(review)}
                onAct={(action) => act(review, action)}
              />
            </li>
          ))}
        </ul>
      )}

      {list && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className={helpTextClass}>{t("pagination", { total: list.total, page: list.page, pages: totalPages })}</p>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link href={filterHref(filter, list.page - 1)} className={secondaryButtonClass}>
                {tPagination("previous")}
              </Link>
            ) : null}
            {list.page < totalPages ? (
              <Link href={filterHref(filter, list.page + 1)} className={secondaryButtonClass}>
                {tPagination("next")}
              </Link>
            ) : null}
          </div>
        </div>
      )}

      <Modal
        open={hiding !== null}
        onClose={() => {
          setHiding(null);
          setReason(null);
        }}
        initialFocus="dialog"
        visual={<HeroMark icon={EyeOff} />}
        title={t("hide.title")}
        description={t("hide.description")}
      >
        <div className="flex flex-col gap-4">
          <ChoiceCards
            name="hide-reason"
            legend={t("hide.legend")}
            legendHidden
            options={REVIEW_HIDE_REASONS.map((value) => ({
              value,
              label: t(`reasons.${value}.label`),
              hint: t(`reasons.${value}.hint`),
            }))}
            value={reason}
            onChange={setReason}
            required
          />
          <p className={infoTextClass}>{t("hide.legal")}</p>
          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => setHiding(null)}>
              {tActions("cancel")}
            </Button>
            <Button
              type="button"
              disabled={!reason}
              pending={acting?.action === "hide"}
              onClick={() => hiding && reason && act(hiding, "hide", reason)}
            >
              {t("hide.confirm")}
            </Button>
          </ModalActions>
        </div>
      </Modal>
    </div>
  );
}

function ReviewCard({
  review,
  canModerate,
  busy,
  acting,
  onHide,
  onAct,
}: {
  review: SellerReview;
  canModerate: boolean;
  /** Some review's action is under way: every action waits for it. */
  busy: boolean;
  /** The action under way on THIS review, if any. */
  acting: ReviewVisibilityAction | null;
  onHide: () => void;
  onAct: (action: ReviewVisibilityAction) => void;
}) {
  const t = useTranslations("Products.reviewModeration");
  const tPage = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const hidden = review.hiddenReason !== null;

  return (
    <article
      className={cn(cardClass, "flex flex-col gap-3 p-4")}
      data-review={review.id}
      data-review-moderation={review.moderation}
      data-review-hidden={hidden || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRating value={review.rating} label={tPage("stars", { rating: review.rating })} />
        {review.title && <h3 className="font-inter text-sm font-semibold text-foreground">{review.title}</h3>}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-inter text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{review.authorName}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={review.reviewedAt}>{formatOrderDate(review.reviewedAt, locale)}</time>
        <span aria-hidden="true">·</span>
        <Link href={productEditPath(review.productId)} className="underline-offset-2 hover:underline">
          {review.productTitle}
        </Link>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {review.source !== "native" ? (
          <span className={cn(badgeClass, "text-muted-foreground")}>{tPage("imported", { source: review.source })}</span>
        ) : review.verified ? (
          <span className={cn(badgeClass, "text-foreground")}>{tPage("verified")}</span>
        ) : null}
        {review.moderation !== "clean" && (
          <span
            className={cn(badgeClass, review.moderation === "blocked" ? "text-destructive" : "text-muted-foreground")}
            data-review-status={review.moderation}
          >
            {t(`status.${review.moderation}`)}
            {review.ground && review.moderation !== "pending" ? ` · ${t(`grounds.${review.ground}`)}` : ""}
          </span>
        )}
        {hidden && review.hiddenReason && (
          <span className={cn(badgeClass, "text-muted-foreground")}>
            {t("hiddenBecause", { reason: t(`reasons.${review.hiddenReason}.label`) })}
          </span>
        )}
      </div>
      {review.body && (
        <div className="flex flex-col gap-2 font-inter text-sm leading-relaxed text-foreground">
          {paragraphs(review.body).map((text, index) => (
            <p key={index} className="whitespace-pre-line">
              {text}
            </p>
          ))}
        </div>
      )}
      {canModerate && (
        <div className="flex flex-wrap gap-2 pt-1">
          {review.moderation === "held" && (
            <Button variant="secondary" disabled={busy} pending={acting === "publish"} onClick={() => onAct("publish")}>
              {t("actions.publish")}
            </Button>
          )}
          {hidden ? (
            <Button variant="secondary" disabled={busy} pending={acting === "show"} onClick={() => onAct("show")}>
              {t("actions.show")}
            </Button>
          ) : (
            review.moderation !== "blocked" && (
              <Button variant="secondary" disabled={busy} onClick={onHide}>
                {t("actions.hide")}
              </Button>
            )
          )}
        </div>
      )}
    </article>
  );
}
