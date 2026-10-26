import { BadgeCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatOrderDate } from "@/lib/format/date";
import type { PublicReview } from "@/types/review";
import { StarRating } from "./StarRating";
import { chipStyle, paragraphs } from "./product-page-maps";

/**
 * One review in the feed: stars, title, who and when, where it came from, and
 * the words. Every string is a React text node; a review has no markup path.
 *
 * The badge says exactly what we know. "Verified buyer" only for a review
 * written from a paid, unrefunded order here; an imported review says where
 * it was imported from, and nothing more, because we did not check it.
 */
export function ReviewItem({
  review,
  ink,
  cornerRadius,
}: {
  review: PublicReview;
  ink: string;
  cornerRadius: number;
}) {
  const t = useTranslations("ProductPage.reviews");
  const locale = useLocale() as Locale;
  const badge = review.source !== "native" ? t("imported", { source: review.source }) : review.verified ? t("verified") : null;

  return (
    <article className="flex flex-col gap-2 py-5" data-review={review.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRating value={review.rating} label={t("stars", { rating: review.rating })} />
        {review.title && <h3 className="text-sm font-semibold">{review.title}</h3>}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-70">
        <span className="font-medium">{review.authorName}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={review.reviewedAt}>{formatOrderDate(review.reviewedAt, locale)}</time>
      </p>
      {badge && (
        <span
          className="inline-flex w-fit items-center gap-1 px-2 py-0.5 text-xs font-medium"
          style={chipStyle(ink, cornerRadius)}
          data-review-badge={review.source === "native" ? "verified" : "imported"}
        >
          {review.source === "native" && <BadgeCheck aria-hidden="true" className="size-3.5" strokeWidth={2} />}
          {badge}
        </span>
      )}
      {review.body && (
        <div className="flex flex-col gap-2 text-sm leading-relaxed">
          {paragraphs(review.body).map((text, index) => (
            <p key={index} className="whitespace-pre-line">
              {text}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
