"use client";

import { useTranslations } from "next-intl";
import { DownloadButton } from "@/components/ui/DownloadButton";
import { REVIEWS_EXPORT_TRUNCATED_HEADER } from "@/lib/reviews/export";
import { reviewsExportHref, type SellerReviewFilters } from "@/lib/reviews/seller-filters";

/**
 * "Export CSV" on the reviews page: the reviews the list shows, every page of
 * them, as a file (app/api/sellers/export-reviews). It follows the view: a
 * tab, a search or a filter narrows the file exactly as it narrows the list.
 * Off while the view is empty, where the file would hold only its header.
 */
export function ReviewsExportButton({
  filters,
  count,
  className,
}: {
  filters: SellerReviewFilters;
  /** Reviews in the view, across every page. */
  count: number;
  className?: string;
}) {
  const t = useTranslations("Products.reviewModeration.export");
  return (
    <DownloadButton
      href={reviewsExportHref(filters)}
      fallbackFileName={t("fileName")}
      truncated={{ header: REVIEWS_EXPORT_TRUNCATED_HEADER, message: (rows) => t("truncated", { count: rows }) }}
      disabled={count === 0}
      title={count === 0 ? t("empty") : t("hint")}
      className={className}
      data-reviews-export={count === 0 ? "empty" : "ready"}
    />
  );
}
