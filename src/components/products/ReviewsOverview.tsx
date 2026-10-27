"use client";

import { useTranslations } from "next-intl";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardClass } from "@/components/ui/surface-styles";
import { focusRingClass, transitionClass } from "@/components/ui/control-styles";
import { StarRating } from "@/components/product-page/StarRating";
import { REVIEW_RATING_MAX } from "@/lib/reviews/limits";
import type { RatingSummary } from "@/types/review";

/** Five stars down to one, the order a breakdown is read in. */
const STAR_ROWS = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => REVIEW_RATING_MAX - index);

/**
 * The store's rating at a glance: the average buyers are shown, and how the
 * reviews split across the stars. Each star row is also a filter: press it to
 * see only those reviews, press it again to see them all.
 *
 * Counts public reviews only (product_rating_summaries), so it is the number a
 * buyer sees, not one inflated by reviews still held or hidden.
 */
export function ReviewsOverview({
  summary,
  rating,
  onRating,
}: {
  summary: RatingSummary;
  /** The star filter in force, if any. */
  rating: number | undefined;
  onRating: (stars: number | undefined) => void;
}) {
  const t = useTranslations("Products.reviewModeration.overview");
  const tPage = useTranslations("ProductPage.reviews");
  const largest = Math.max(1, ...summary.breakdown);

  return (
    <section
      aria-label={t("label")}
      className={cn(cardClass, "grid gap-5 p-4 @md:grid-cols-[auto_1fr] @md:gap-8 @md:p-5")}
      data-reviews-overview=""
    >
      <div className="flex flex-col justify-center gap-1.5">
        <p className="font-inter text-xs font-medium text-muted-foreground">{t("label")}</p>
        {summary.average === null ? (
          <p className="font-inter text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <>
            <p className="flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tabular-nums text-foreground">
                {summary.average.toFixed(1)}
              </span>
              <span className="font-inter text-sm text-muted-foreground">/ {REVIEW_RATING_MAX}</span>
            </p>
            <span className="text-rating">
              <StarRating value={summary.average} label={tPage("average", { average: summary.average.toFixed(1) })} size="md" />
            </span>
            <p className="font-inter text-xs text-muted-foreground">{tPage("count", { count: summary.count })}</p>
          </>
        )}
      </div>

      <ul className="flex flex-col gap-1" aria-label={t("breakdown")}>
        {STAR_ROWS.map((stars) => {
          const count = summary.breakdown[stars - 1];
          const active = rating === stars;
          return (
            <li key={stars}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={t("showStars", { stars, count })}
                onClick={() => onRating(active ? undefined : stars)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-sm px-2 py-1 text-left",
                  transitionClass,
                  focusRingClass,
                  active ? "bg-rating/15" : "hover:bg-accent",
                )}
                data-rating-filter={stars}
              >
                <span aria-hidden="true" className="flex w-9 shrink-0 items-center gap-1 font-inter text-xs font-medium tabular-nums text-foreground">
                  {stars}
                  <Star aria-hidden="true" className="size-3.5 fill-rating text-rating" strokeWidth={1.5} />
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full bg-rating",
                      transitionClass,
                      rating !== undefined && !active && "opacity-40",
                    )}
                    style={{ width: `${(count / largest) * 100}%` }}
                  />
                </span>
                <span aria-hidden="true" className="w-8 shrink-0 text-right font-inter text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
