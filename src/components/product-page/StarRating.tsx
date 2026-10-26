import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { REVIEW_RATING_MAX } from "@/lib/reviews/limits";

const STARS = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => index);

/** Star sizes: a review's own line, and the summary's headline. */
const STAR_SIZE = { sm: "size-3.5", md: "size-5" } as const;

/**
 * A rating as five stars, in the page's own ink: filled up to `value`
 * (fractions included, for an average), faint beyond it. One image to a
 * screen reader, named by `label` ("4.5 out of 5 stars"), never five.
 */
export function StarRating({
  value,
  label,
  size = "sm",
}: {
  value: number;
  label: string;
  size?: keyof typeof STAR_SIZE;
}) {
  const filled = `${Math.max(0, Math.min(1, value / REVIEW_RATING_MAX)) * 100}%`;
  const row = (fill: boolean) =>
    STARS.map((index) => (
      <Star
        key={index}
        aria-hidden="true"
        className={cn(STAR_SIZE[size], "shrink-0")}
        strokeWidth={1.5}
        fill={fill ? "currentColor" : "none"}
      />
    ));
  return (
    // w-fit: the fill is a share of the stars' own width, so the box must
    // never stretch to its parent's (a flex column does that by default).
    <span role="img" aria-label={label} className="relative inline-flex w-fit shrink-0" data-star-rating={value}>
      <span className="inline-flex opacity-30">{row(false)}</span>
      <span className="absolute inset-y-0 left-0 inline-flex overflow-hidden" style={{ width: filled }}>
        {row(true)}
      </span>
    </span>
  );
}
