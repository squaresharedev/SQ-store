// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_FILTERS,
  REVIEWS_SEARCH_MAX_LENGTH,
  hasReviewNarrowing,
  parseSellerReviewFilters,
  sellerReviewsHref,
} from "@/lib/reviews/seller-filters";

/**
 * The reviews page's view lives in the URL: the server parses it, the toolbar
 * writes it. What is pinned here is that the two agree, and that a stale or
 * hand-edited link opens the page with the bad part dropped, never an error.
 */

const PRODUCT = "577c5e40-51a9-49e6-a272-38ad9549111f";

describe("parseSellerReviewFilters", () => {
  it("reads a plain address as the default view, page 1", () => {
    expect(parseSellerReviewFilters({})).toEqual({ filters: DEFAULT_REVIEW_FILTERS, page: 1 });
  });

  it("reads every param it knows", () => {
    expect(
      parseSellerReviewFilters({
        filter: "held",
        q: "  broke  ",
        rating: "1",
        product: PRODUCT,
        source: "imported",
        sort: "lowest",
        page: "3",
      }),
    ).toEqual({
      filters: { status: "held", search: "broke", rating: 1, productId: PRODUCT, origin: "imported", sort: "lowest" },
      page: 3,
    });
  });

  it.each([
    ["an unknown tab", { filter: "deleted" }],
    ["a rating off the scale", { rating: "6" }],
    ["a fractional rating", { rating: "4.5" }],
    ["a product that is not an id", { product: "1 or 1=1" }],
    ["an unknown source", { source: "amazon" }],
    ["an unknown ordering", { sort: "random" }],
    ["a blank search", { q: "   " }],
    ["a page below one", { page: "0" }],
    ["a page that is not a number", { page: "two" }],
  ])("drops %s", (_name, params) => {
    expect(parseSellerReviewFilters(params)).toEqual({ filters: DEFAULT_REVIEW_FILTERS, page: 1 });
  });

  it("caps the search term at the box's own limit", () => {
    const { filters } = parseSellerReviewFilters({ q: "x".repeat(REVIEWS_SEARCH_MAX_LENGTH + 50) });
    expect(filters.search).toHaveLength(REVIEWS_SEARCH_MAX_LENGTH);
  });

  it("takes the first of a repeated param", () => {
    expect(parseSellerReviewFilters({ rating: ["5", "1"] }).filters.rating).toBe(5);
  });
});

describe("sellerReviewsHref", () => {
  it("leaves defaults out, so the plain view is the plain address", () => {
    expect(sellerReviewsHref(DEFAULT_REVIEW_FILTERS)).toBe("/products/reviews");
  });

  it("round-trips through the parser", () => {
    const filters = {
      status: "hidden" as const,
      search: "size & fit?",
      rating: 2,
      productId: PRODUCT,
      origin: "verified" as const,
      sort: "oldest" as const,
    };
    const href = sellerReviewsHref(filters, 4);
    const params = Object.fromEntries(new URL(href, "https://x.test").searchParams);
    expect(parseSellerReviewFilters(params)).toEqual({ filters, page: 4 });
  });
});

describe("hasReviewNarrowing", () => {
  it("counts search and filters, but not the tab or the ordering", () => {
    expect(hasReviewNarrowing({ status: "held", sort: "lowest" })).toBe(false);
    expect(hasReviewNarrowing({ status: "all", sort: "newest", search: "mug" })).toBe(true);
    expect(hasReviewNarrowing({ status: "all", sort: "newest", rating: 3 })).toBe(true);
  });
});
