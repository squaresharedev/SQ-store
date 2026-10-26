import { REVIEW_RATING_MAX, REVIEW_RATING_MIN } from "@/lib/reviews/limits";
import { REVIEW_MODERATION_FILTERS, type ReviewModerationFilter } from "@/lib/reviews/moderation-rules";
import {
  REVIEWS_FILTER_PARAM,
  REVIEWS_PAGE_PARAM,
  REVIEWS_PATH,
  REVIEWS_PRODUCT_PARAM,
  REVIEWS_RATING_PARAM,
  REVIEWS_SEARCH_PARAM,
  REVIEWS_SORT_PARAM,
  REVIEWS_SOURCE_PARAM,
} from "@/lib/reviews/paths";

/**
 * How the seller's reviews page is narrowed and ordered, and how that view is
 * written to and read back from the address. Pure: the server page parses the
 * URL with it and the client toolbar builds links with it, so the two can
 * never disagree about a param.
 *
 * Everything here round-trips through the URL and comes back untrusted, so
 * parsing drops what it does not recognise instead of failing: a stale or
 * hand-edited link opens the page with that one filter off.
 */

/** Orderings, newest first by default: the buyer feed's (REVIEW_SORTS), plus oldest. */
export const SELLER_REVIEW_SORTS = ["newest", "oldest", "highest", "lowest"] as const;
export type SellerReviewSort = (typeof SELLER_REVIEW_SORTS)[number];

/** Where a review came from: written here by a buyer (verified), or imported. */
export const REVIEW_ORIGIN_FILTERS = ["verified", "imported"] as const;
export type ReviewOriginFilter = (typeof REVIEW_ORIGIN_FILTERS)[number];

/** Longest search term the page accepts; the box and the parser agree on it. */
export const REVIEWS_SEARCH_MAX_LENGTH = 100;

/** Highest page number the page will ask for. */
const REVIEWS_PAGE_MAX = 10_000;

export type SellerReviewFilters = {
  status: ReviewModerationFilter;
  /** Matched against the review's title, text and author. */
  search?: string;
  rating?: number;
  productId?: string;
  origin?: ReviewOriginFilter;
  sort: SellerReviewSort;
};

export const DEFAULT_REVIEW_FILTERS: SellerReviewFilters = { status: "all", sort: "newest" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return (list as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

/** The view a URL asks for, with anything unrecognised dropped. */
export function parseSellerReviewFilters(params: Params): { filters: SellerReviewFilters; page: number } {
  const search = first(params[REVIEWS_SEARCH_PARAM])?.trim().slice(0, REVIEWS_SEARCH_MAX_LENGTH);
  const rating = Number(first(params[REVIEWS_RATING_PARAM]));
  const productId = first(params[REVIEWS_PRODUCT_PARAM]);
  const page = Number(first(params[REVIEWS_PAGE_PARAM]) ?? 1);

  return {
    filters: {
      status: oneOf(REVIEW_MODERATION_FILTERS, first(params[REVIEWS_FILTER_PARAM])) ?? "all",
      search: search ? search : undefined,
      rating:
        Number.isInteger(rating) && rating >= REVIEW_RATING_MIN && rating <= REVIEW_RATING_MAX ? rating : undefined,
      productId: productId && UUID.test(productId) ? productId : undefined,
      origin: oneOf(REVIEW_ORIGIN_FILTERS, first(params[REVIEWS_SOURCE_PARAM])),
      sort: oneOf(SELLER_REVIEW_SORTS, first(params[REVIEWS_SORT_PARAM])) ?? "newest",
    },
    page: Number.isInteger(page) && page >= 1 && page <= REVIEWS_PAGE_MAX ? page : 1,
  };
}

/** Whether anything beyond the status tab narrows the list. */
export function hasReviewNarrowing(filters: SellerReviewFilters): boolean {
  return Boolean(filters.search || filters.rating || filters.productId || filters.origin);
}

/** The reviews page on a view. Defaults are left out, so a plain view stays a plain URL. */
export function sellerReviewsHref(filters: SellerReviewFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set(REVIEWS_FILTER_PARAM, filters.status);
  if (filters.search) params.set(REVIEWS_SEARCH_PARAM, filters.search);
  if (filters.rating) params.set(REVIEWS_RATING_PARAM, String(filters.rating));
  if (filters.productId) params.set(REVIEWS_PRODUCT_PARAM, filters.productId);
  if (filters.origin) params.set(REVIEWS_SOURCE_PARAM, filters.origin);
  if (filters.sort !== "newest") params.set(REVIEWS_SORT_PARAM, filters.sort);
  if (page > 1) params.set(REVIEWS_PAGE_PARAM, String(page));
  const query = params.toString();
  return query ? `${REVIEWS_PATH}?${query}` : REVIEWS_PATH;
}
