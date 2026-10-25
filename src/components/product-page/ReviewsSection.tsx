import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatFixed } from "@/lib/format/intl";
import { REVIEW_RATING_MAX } from "@/lib/reviews/limits";
import type { ProductReviews } from "@/types/review";
import { ReviewFeed } from "./ReviewFeed";
import { StarRating } from "./StarRating";
import type { CtaAppearance } from "./product-page-maps";

/** 5 down to 1: the breakdown reads best-first, like every review site. */
const BREAKDOWN_ORDER = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => REVIEW_RATING_MAX - index);

/**
 * The product page's reviews: the average, how many, the 5..1 breakdown, and
 * the feed. Open at the foot of the page, not folded into "More details":
 * what other buyers said is something a buyer reads, not looks up.
 *
 * Drawn in the page's own ink and hairlines, like every other section, so it
 * belongs to the seller's shop. Absent until the first review: an empty
 * "No reviews yet" on every new listing is clutter, not information.
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
  const { summary, firstPage } = reviews;
  if (summary.count === 0 || summary.average === null) return null;
  const average = formatFixed(summary.average, 1, locale);

  return (
    <section
      className="mt-10 border-t pt-6"
      style={{ borderColor: rule }}
      aria-labelledby="product-reviews"
      data-product-section="reviews"
    >
      <h2 id="product-reviews" className="pb-4 text-lg font-semibold">
        {t("heading")}
      </h2>
      <div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @3xl:gap-14">
        <div className="flex flex-col gap-4" data-review-summary={summary.average}>
          <div className="flex items-center gap-3">
            <span className="text-4xl font-semibold leading-none tabular-nums">{average}</span>
            <div className="flex flex-col gap-1">
              <StarRating value={summary.average} label={t("average", { average })} size="md" />
              <span className="text-xs opacity-70">{t("count", { count: summary.count })}</span>
            </div>
          </div>
          <dl className="flex flex-col gap-1.5 text-xs">
            {BREAKDOWN_ORDER.map((stars) => {
              const count = summary.breakdown[stars - 1];
              return (
                <div key={stars} className="flex items-center gap-2" data-review-breakdown={stars}>
                  <dt className="w-12 shrink-0 tabular-nums opacity-70">{t("starsShort", { rating: stars })}</dt>
                  <dd className="flex flex-1 items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: rule }}>
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${(count / summary.count) * 100}%`, backgroundColor: ink }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums opacity-70">{count}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
        <ReviewFeed
          productId={productId}
          initial={firstPage}
          ink={ink}
          rule={rule}
          cta={cta}
          cornerRadius={cornerRadius}
        />
      </div>
    </section>
  );
}
