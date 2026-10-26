"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/locales";
import { formatFixed } from "@/lib/format/intl";
import { REVIEW_RATING_MAX } from "@/lib/reviews/limits";
import type { ProductReviews } from "@/types/review";
import { ReviewFeed } from "./ReviewFeed";
import { StarRating } from "./StarRating";
import { surfaceRadius, type CtaAppearance } from "./product-page-maps";

/** 5 down to 1: the breakdown reads best-first, like every review site. */
const BREAKDOWN_ORDER = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => REVIEW_RATING_MAX - index);

/**
 * The product page's reviews: the average, how many, the 5..1 breakdown, and
 * the feed. Open at the foot of the page, not folded into "More details":
 * what other buyers said is something a buyer reads, not looks up.
 *
 * ONE WAY TO NARROW IT. Each breakdown row is also a button: "show me the
 * 2-star ones" is the question a buyer weighing a product actually asks, and
 * it needs no extra control. Pressed again, or "Show all", it lets go. A row
 * with no reviews is not pressable: it would only lead to an empty list.
 *
 * EMPTY, IT SAYS SO. The seller switched this section on, so a product with
 * no reviews yet shows that plainly (and how one gets written) rather than
 * nothing, which would read as a page that failed to load.
 *
 * Drawn in the page's own ink and hairlines, like every other section, so it
 * belongs to the seller's shop.
 */
export function ReviewsSection({
  productId,
  reviews,
  ink,
  rule,
  cta,
  cornerRadius,
}: {
  productId: string;
  reviews: ProductReviews;
  ink: string;
  rule: string;
  cta: CtaAppearance;
  cornerRadius: number;
}) {
  const t = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const [rating, setRating] = useState<number | undefined>(undefined);
  const { summary, firstPage } = reviews;
  const empty = summary.count === 0 || summary.average === null;

  return (
    <section
      className="mt-10 border-t pt-6"
      style={{ borderColor: rule }}
      aria-labelledby="product-reviews"
      data-product-section="reviews"
      data-setting-hotspot="sections"
    >
      <h2 id="product-reviews" className="pb-4 text-lg font-semibold">
        {t("heading")}
      </h2>

      {empty ? (
        <div className="flex flex-col gap-2" data-reviews-empty="">
          <StarRating value={0} label={t("empty.title")} size="md" />
          <p className="text-sm font-medium">{t("empty.title")}</p>
          <p className="text-sm opacity-70">{t("empty.body")}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @3xl:gap-14">
            <div className="flex flex-col gap-4" data-review-summary={summary.average}>
              <div className="flex items-center gap-3">
                <span className="text-4xl font-semibold leading-none tabular-nums">
                  {formatFixed(summary.average!, 1, locale)}
                </span>
                <div className="flex flex-col gap-1">
                  <StarRating
                    value={summary.average!}
                    label={t("average", { average: formatFixed(summary.average!, 1, locale) })}
                    size="md"
                  />
                  <span className="text-xs opacity-70">{t("count", { count: summary.count })}</span>
                </div>
              </div>
              <ul className="flex flex-col gap-0.5 text-xs" aria-label={t("breakdownLabel")}>
                {BREAKDOWN_ORDER.map((stars) => {
                  const count = summary.breakdown[stars - 1];
                  const active = rating === stars;
                  return (
                    <li key={stars}>
                      <button
                        type="button"
                        aria-pressed={active}
                        aria-label={t("filterStars", { stars, count })}
                        disabled={count === 0}
                        onClick={() => setRating(active ? undefined : stars)}
                        className={cn(
                          "flex w-full items-center gap-2 px-1.5 py-1 text-left transition-opacity duration-base ease-standard",
                          "focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-default enabled:hover:opacity-80",
                          rating !== undefined && !active && "opacity-50",
                        )}
                        style={{
                          borderRadius: surfaceRadius(cornerRadius),
                          backgroundColor: active ? rule : undefined,
                          outlineColor: ink,
                        }}
                        data-review-breakdown={stars}
                      >
                        <span aria-hidden="true" className="w-12 shrink-0 tabular-nums opacity-70">
                          {t("starsShort", { rating: stars })}
                        </span>
                        <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: rule }}>
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${(count / summary.count) * 100}%`, backgroundColor: ink }}
                          />
                        </span>
                        <span aria-hidden="true" className="w-8 shrink-0 text-right tabular-nums opacity-70">
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-col">
              {rating !== undefined && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-sm" data-reviews-filter={rating}>
                  <span className="font-medium">{t("showing", { rating })}</span>
                  <button
                    type="button"
                    onClick={() => setRating(undefined)}
                    className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-80"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                    {t("showAll")}
                  </button>
                </p>
              )}
              {/* Keyed by the rating: each choice starts its own clean list. */}
              <ReviewFeed
                key={rating ?? "all"}
                productId={productId}
                initial={rating === undefined ? firstPage : null}
                rating={rating}
                ink={ink}
                rule={rule}
                cta={cta}
                cornerRadius={cornerRadius}
              />
            </div>
          </div>
          {/* How these reviews were checked: EU consumer law (Directive
              2019/2161) requires saying so wherever reviews are shown. */}
          <p className="mt-6 text-xs opacity-70" data-reviews-about="">
            {t("about")}
          </p>
        </>
      )}
    </section>
  );
}
