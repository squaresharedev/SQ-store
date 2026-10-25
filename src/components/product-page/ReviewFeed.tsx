"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { productReviewsApiPath } from "@/lib/reviews/paths";
import { REVIEW_SORTS, DEFAULT_REVIEW_SORT, type ReviewSort } from "@/lib/reviews/limits";
import type { ReviewPage } from "@/types/review";
import { PageSelect } from "./PageSelect";
import { ReviewItem } from "./ReviewItem";
import { CTA_BUTTON_CLASS, ctaGhostStyle, surfaceRadius, type CtaAppearance } from "./product-page-maps";

/**
 * The review list: the first page arrives with the product page, the rest a
 * page at a time from GET /api/products/[id]/reviews. Changing the order
 * starts again from the first page of that order.
 */
export function ReviewFeed({
  productId,
  initial,
  ink,
  rule,
  cta,
  cornerRadius,
}: {
  productId: string;
  initial: ReviewPage;
  ink: string;
  rule: string;
  cta: CtaAppearance;
  cornerRadius: number;
}) {
  const t = useTranslations("ProductPage.reviews");
  const [rows, setRows] = useState(initial.rows);
  const [page, setPage] = useState(initial.page);
  const [sort, setSort] = useState<ReviewSort>(DEFAULT_REVIEW_SORT);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasMore = page * initial.pageSize < initial.total;

  async function load(nextSort: ReviewSort, nextPage: number) {
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams({ sort: nextSort, page: String(nextPage), pageSize: String(initial.pageSize) });
      const response = await fetch(`${productReviewsApiPath(productId)}?${query}`);
      const result = (await response.json().catch(() => null)) as { ok: true; page: ReviewPage } | { ok: false } | null;
      if (!result?.ok) {
        setFailed(true);
        return;
      }
      setRows((current) => (nextPage === 1 ? result.page.rows : [...current, ...result.page.rows]));
      setPage(nextPage);
      setSort(nextSort);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col" aria-busy={loading}>
      {initial.total > 1 && (
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
          className={cn(CTA_BUTTON_CLASS, "mt-4 w-auto self-start hover:opacity-90 disabled:opacity-60")}
          style={ctaGhostStyle(cta, ink)}
          data-reviews-more=""
        >
          {loading ? t("loading") : t("more")}
        </button>
      )}
    </div>
  );
}
