"use client";

import { useEffect, useState } from "react";
import { productReviewsApiPath } from "@/lib/reviews/paths";
import { REVIEW_PAGE_SIZE } from "@/lib/reviews/limits";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import { uuidField } from "@/lib/validation/inputs";
import type { ProductReviews, RatingSummary, ReviewPage } from "@/types/review";

/** No reviews: what a product nobody has reviewed shows, and what a page no buyer can reach previews as. */
const NO_REVIEWS: ProductReviews = {
  summary: { count: 0, average: null, breakdown: [0, 0, 0, 0, 0] },
  firstPage: { rows: [], total: 0, page: 1, pageSize: REVIEW_PAGE_SIZE },
};

const productIdSchema = uuidField("product");

/**
 * THE REVIEWS AN ARTBOARD PREVIEWS: the ones a buyer would see on this
 * product's page, read through the same public endpoint the page's own feed
 * uses, so the preview can never show a review a buyer would not get.
 *
 * Read only while the section is switched on. A product no buyer can reach
 * (a draft, one taken down) answers 404, and so does the sample storefront's,
 * which exist only in code: those preview as having no reviews, which is what
 * a buyer would see. Null until the read answers, and on a failed one, so the
 * section stays out rather than claiming "no reviews" that might not be true.
 */
export function usePreviewReviews(productId: string, enabled: boolean): ProductReviews | null {
  const sample = useSampleMode();
  const [loaded, setLoaded] = useState<{ productId: string; reviews: ProductReviews | null } | null>(null);
  const readable = !sample && productIdSchema.safeParse(productId).success;

  useEffect(() => {
    if (!enabled || !readable) return;
    let cancelled = false;
    const query = new URLSearchParams({ pageSize: String(REVIEW_PAGE_SIZE) });
    fetch(`${productReviewsApiPath(productId)}?${query}`)
      .then(async (response) => {
        if (response.status === 404) return NO_REVIEWS;
        const body = (await response.json().catch(() => null)) as
          | { ok: true; summary: RatingSummary; page: ReviewPage }
          | { ok: false }
          | null;
        return body?.ok ? { summary: body.summary, firstPage: body.page } : null;
      })
      .catch(() => null)
      .then((reviews) => {
        if (!cancelled) setLoaded({ productId, reviews });
      });
    return () => {
      cancelled = true;
    };
  }, [productId, enabled, readable]);

  if (!enabled) return null;
  if (!readable) return NO_REVIEWS;
  return loaded?.productId === productId ? loaded.reviews : null;
}
