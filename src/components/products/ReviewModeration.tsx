"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/AppLink";
import { useTranslations } from "next-intl";
import { EyeOff, MessageSquareQuote, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { HeroMark } from "@/components/ui/HeroMark";
import { PageTabs } from "@/components/ui/PageTabs";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import { cardClass } from "@/components/ui/surface-styles";
import { errorTextClass, helpTextClass, infoTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { usePendingRouter } from "@/lib/hooks/usePendingRouter";
import { setReviewVisibility } from "@/lib/reviews/actions";
import {
  REVIEW_HIDE_REASONS,
  REVIEW_MODERATION_FILTERS,
  type ReviewHideReason,
  type ReviewVisibilityAction,
} from "@/lib/reviews/moderation-rules";
import { hasReviewNarrowing, sellerReviewsHref, type SellerReviewFilters } from "@/lib/reviews/seller-filters";
import type { SellerReviewList, SellerReviewOverview } from "@/lib/reviews/seller-queries";
import type { SellerReview } from "@/types/review";
import { ReviewCard } from "./ReviewCard";
import { ReviewsOverview } from "./ReviewsOverview";
import { ReviewsToolbar } from "./ReviewsToolbar";

/**
 * A store's reviews: its rating at a glance, a search box and filters to find
 * the ones that matter, and the three things a seller can do to one: hide it
 * for a reason, show it again, publish one the automatic check held.
 *
 * The view (tab, search, filters, sort, page) lives in the URL and the server
 * reads it, so a filtered list can be bookmarked and shared, and back and
 * forward step through it.
 *
 * HIDING ASKS WHY, from a closed list, and says why it asks: hiding a review
 * because it is negative misleads buyers, which EU consumer law forbids. The
 * reasons are the ones that are not about the opinion (see
 * lib/reviews/moderation-rules.ts), and there is no free-text "other".
 *
 * A review the check BLOCKED is shown with its reason and no way to publish
 * it: it broke a rule, and that is not the seller's to overrule.
 */
export function ReviewModeration({
  list,
  overview,
  filters,
  canModerate,
}: {
  /** Null when the read failed. */
  list: SellerReviewList | null;
  /** Null when the read failed; the list still works without it. */
  overview: SellerReviewOverview | null;
  filters: SellerReviewFilters;
  canModerate: boolean;
}) {
  const t = useTranslations("Products.reviewModeration");
  const tPagination = useTranslations("Common.pagination");
  const tActions = useTranslations("Common.actions");
  const router = usePendingRouter();
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

  /** Show another view of the list. Any change of view starts again at page 1. */
  function view(next: SellerReviewFilters) {
    router.replace(sellerReviewsHref(next), { scroll: false });
  }

  const narrowed = hasReviewNarrowing(filters);
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="space-y-5">
      {overview && overview.summary.count > 0 && (
        <ReviewsOverview
          summary={overview.summary}
          rating={filters.rating}
          onRating={(rating) => view({ ...filters, rating })}
        />
      )}

      <PageTabs
        ariaLabel={t("filtersLabel")}
        onNavigate={(href) => router.replace(href, { scroll: false })}
        tabs={REVIEW_MODERATION_FILTERS.map((value) => ({
          // A tab keeps the search and filters: "waiting for you, about this
          // product" is one question, not two.
          href: sellerReviewsHref({ ...filters, status: value }),
          label: t(`filters.${value}`),
          active: value === filters.status,
          ...(value === "held" && list && list.held > 0
            ? { count: list.held, countLabel: t("heldCount", { count: list.held }) }
            : {}),
        }))}
      />

      {(narrowed || (list && list.total > 0)) && (
        <ReviewsToolbar filters={filters} products={overview?.products ?? []} onChange={view} />
      )}

      {/* While a new view loads the current one stays put, dimmed and not
          taking clicks, so nothing jumps and nothing is acted on by mistake. */}
      <div
        aria-busy={router.pending}
        className={cn(
          "space-y-3 transition-opacity duration-base ease-standard motion-reduce:transition-none",
          router.pending && "pointer-events-none opacity-60",
        )}
      >
        {!list ? (
          <p className={errorTextClass} role="alert">
            {t("loadFailed")}
          </p>
        ) : list.rows.length === 0 ? (
          <div className={cn(cardClass, "flex flex-col items-center gap-3 px-6 py-10 text-center")} data-reviews-empty="">
            <HeroMark icon={narrowed ? SearchX : MessageSquareQuote} />
            <p className="font-inter text-sm font-medium text-foreground">
              {narrowed ? t("emptyFiltered.title") : t(`empty.${filters.status}.title`)}
            </p>
            <p className={helpTextClass}>{narrowed ? t("emptyFiltered.body") : t(`empty.${filters.status}.body`)}</p>
            {narrowed && (
              <Button variant="secondary" onClick={() => view({ status: filters.status, sort: filters.sort })}>
                {t("toolbar.clear")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <p className={helpTextClass} aria-live="polite" data-reviews-count="">
              {t("results", { count: list.total })}
            </p>
            <ul className="space-y-3" data-reviews-list="">
              {list.rows.map((review) => (
                <li key={review.id}>
                  <ReviewCard
                    review={review}
                    canModerate={canModerate}
                    busy={pending}
                    acting={acting?.id === review.id ? acting.action : null}
                    search={filters.search}
                    onHide={() => setHiding(review)}
                    onAct={(action) => act(review, action)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {list && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className={helpTextClass}>{t("pagination", { total: list.total, page: list.page, pages: totalPages })}</p>
          <div className="flex gap-2">
            {list.page > 1 ? (
              <Link href={sellerReviewsHref(filters, list.page - 1)} className={secondaryButtonClass}>
                {tPagination("previous")}
              </Link>
            ) : null}
            {list.page < totalPages ? (
              <Link href={sellerReviewsHref(filters, list.page + 1)} className={secondaryButtonClass}>
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
