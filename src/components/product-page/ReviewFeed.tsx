"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { productReviewsApiPath } from "@/lib/reviews/paths";
import { REVIEW_PAGE_SIZE, REVIEW_SORTS, DEFAULT_REVIEW_SORT, type ReviewSort } from "@/lib/reviews/limits";
import type { ReviewPage } from "@/types/review";
import { PageSelect } from "./PageSelect";
import { ReviewItem } from "./ReviewItem";
import {
  CTA_BUTTON_CLASS,
  REVIEW_FEED_SCROLL_CLASS,
  ctaGhostStyle,
  surfaceRadius,
  type CtaAppearance,
} from "./product-page-maps";

/**
 * The review list: the first page arrives with the product page, the rest a
 * page at a time from GET /api/products/[id]/reviews. Changing the order
 * starts again from the first page of that order.
 *
 * The list scrolls inside a fixed height (REVIEW_FEED_SCROLL_CLASS) rather
 * than lengthening the page, with "Show more reviews" at the end of it. It is
 * a focusable, named region so a keyboard can scroll it, and a new order or
 * rating starts it back at the top.
 *
 * Narrowed to one star rating (`rating`), the feed has no first page handed
 * to it and reads its own on mount; the section remounts it (keyed by the
 * rating) whenever the buyer picks another, so each rating starts clean.
 */
export function ReviewFeed({
  productId,
  initial,
  rating,
  ink,
  rule,
  cta,
  cornerRadius,
}: {
  productId: string;
  /** The first page, newest first; null to read it on mount (a filtered view). */
  initial: ReviewPage | null;
  /** Only reviews with this many stars. */
  rating?: number;
  ink: string;
  rule: string;
  cta: CtaAppearance;
  cornerRadius: number;
}) {
  const t = useTranslations("ProductPage.reviews");
  const [rows, setRows] = useState(initial?.rows ?? []);
  const [page, setPage] = useState(initial?.page ?? 0);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [sort, setSort] = useState<ReviewSort>(DEFAULT_REVIEW_SORT);
  const [loading, setLoading] = useState(initial === null);
  const [failed, setFailed] = useState(false);
  const pageSize = initial?.pageSize ?? REVIEW_PAGE_SIZE;
  const hasMore = page * pageSize < total;
  const scroller = useRef<HTMLDivElement>(null);

  /** One page of this view from the API; null when it could not be read. */
  async function fetchPage(nextSort: ReviewSort, nextPage: number): Promise<ReviewPage | null> {
    const query = new URLSearchParams({ sort: nextSort, page: String(nextPage), pageSize: String(pageSize) });
    if (rating) query.set("rating", String(rating));
    try {
      const response = await fetch(`${productReviewsApiPath(productId)}?${query}`);
      const result = (await response.json().catch(() => null)) as { ok: true; page: ReviewPage } | { ok: false } | null;
      return result?.ok ? result.page : null;
    } catch {
      return null;
    }
  }

  /** Take in a page that answered (or note that none did). */
  function apply(result: ReviewPage | null, nextSort: ReviewSort, nextPage: number) {
    setLoading(false);
    if (!result) {
      setFailed(true);
      return;
    }
    setRows((current) => (nextPage === 1 ? result.rows : [...current, ...result.rows]));
    if (nextPage === 1 && scroller.current) scroller.current.scrollTop = 0;
    setPage(nextPage);
    setTotal(result.total);
    setSort(nextSort);
  }

  async function load(nextSort: ReviewSort, nextPage: number) {
    setLoading(true);
    setFailed(false);
    apply(await fetchPage(nextSort, nextPage), nextSort, nextPage);
  }

  // A filtered view has no first page of its own: read it once, on mount
  // (`loading` already starts true for it). State is written only when the
  // read answers, and never after the feed has gone.
  useEffect(() => {
    if (initial !== null) return;
    let gone = false;
    void fetchPage(DEFAULT_REVIEW_SORT, 1).then((result) => {
      if (!gone) apply(result, DEFAULT_REVIEW_SORT, 1);
    });
    return () => {
      gone = true;
    };
    // Mount only: the section remounts the feed for each rating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col" aria-busy={loading}>
      {total > 1 && (
        <div className="flex justify-end pb-2">
          <PageSelect
            id={`reviews-sort-${productId}`}
            label={t("sortLabel")}
            value={sort}
            options={REVIEW_SORTS.map((value) => ({ value, label: t(`sorts.${value}`) }))}
            onChange={(value) => void load(value as ReviewSort, 1)}
            radius={surfaceRadius(cornerRadius)}
            ink={ink}
            className="w-44"
          />
        </div>
      )}
      <div
        ref={scroller}
        role="region"
        aria-label={t("list")}
        tabIndex={0}
        className={cn("flex flex-col", REVIEW_FEED_SCROLL_CLASS)}
        data-review-scroll=""
      >
        <div className={cn("flex flex-col divide-y", loading && "opacity-60")} data-review-feed="">
          {rows.map((review) => (
            <div key={review.id} style={{ borderColor: rule }}>
              <ReviewItem review={review} ink={ink} cornerRadius={cornerRadius} />
            </div>
          ))}
        </div>
        {failed && (
          <p role="alert" className="pt-2 text-sm font-medium text-destructive">
            {t("loadFailed")}
          </p>
        )}
        {hasMore && (
          <button
            type="button"
            onClick={() => void load(sort, page + 1)}
            disabled={loading}
            className={cn(CTA_BUTTON_CLASS, "my-4 w-auto shrink-0 self-start hover:opacity-90 disabled:opacity-60")}
            style={ctaGhostStyle(cta, ink)}
            data-reviews-more=""
          >
            {loading ? t("loading") : t("more")}
          </button>
        )}
      </div>
    </div>
  );
}
