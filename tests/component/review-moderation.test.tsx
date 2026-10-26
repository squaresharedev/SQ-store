import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "../setup/render";
import { ReviewModeration } from "@/components/products/ReviewModeration";
import type { SellerReviewFilters } from "@/lib/reviews/seller-filters";
import type { SellerReviewList, SellerReviewOverview } from "@/lib/reviews/seller-queries";
import type { SellerReview } from "@/types/review";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";

/**
 * The seller's reviews page: the store's rating, a search box and filters
 * that write the URL, and review cards that say at a glance how each one
 * stands. Navigation is recorded, not performed: the server reads the URL.
 */

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/products/reviews",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/reviews/actions", () => ({ setReviewVisibility: vi.fn() }));

afterEach(cleanup);
beforeEach(() => replace.mockClear());

const ALL: SellerReviewFilters = { status: "all", sort: "newest" };

function review(overrides: Partial<SellerReview> = {}): SellerReview {
  return {
    id: "r-1",
    productId: "577c5e40-51a9-49e6-a272-38ad9549111f",
    productTitle: "Roundhouse Coffee Table",
    rating: 5,
    title: "Love it",
    body: "The table broke the internet, it is that good.",
    authorName: "Hannah K.",
    verified: true,
    source: "native",
    reviewedAt: "2026-10-20T10:00:00.000Z",
    moderation: "clean",
    ground: null,
    hiddenReason: null,
    ...overrides,
  };
}

function list(rows: SellerReview[]): SellerReviewList {
  return { rows, total: rows.length, page: 1, pageSize: 20, held: rows.filter((r) => r.moderation === "held").length };
}

const OVERVIEW: SellerReviewOverview = {
  summary: { count: 30, average: 4.13, breakdown: [2, 1, 2, 11, 14] },
  products: [
    { id: "577c5e40-51a9-49e6-a272-38ad9549111f", title: "Roundhouse Coffee Table" },
    { id: "1e2ba73d-3d12-4876-b41a-a69d50590696", title: "Braid Knit Pouffe" },
  ],
};

function mount(filters: SellerReviewFilters = ALL, rows: SellerReview[] = [review()]) {
  return render(<ReviewModeration list={list(rows)} overview={OVERVIEW} filters={filters} canModerate />);
}

describe("ReviewModeration", () => {
  it("shows the store's rating, and each star row filters to those reviews", () => {
    mount();
    const overview = screen.getByRole("region", { name: "Store rating" });
    expect(within(overview).getByText("4.1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show only 5-star reviews (14)" }));
    expect(replace).toHaveBeenCalledWith("/products/reviews?rating=5", { scroll: false });
  });

  it("presses the star row in force, and pressing it again shows them all", () => {
    mount({ ...ALL, rating: 4 });
    const row = screen.getByRole("button", { name: "Show only 4-star reviews (11)" });
    expect(row).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(row);
    expect(replace).toHaveBeenCalledWith("/products/reviews", { scroll: false });
  });

  it("paints a review's stars in the rating colour", () => {
    mount();
    const rating = screen.getByRole("img", { name: "Rated 5 stars out of 5" });
    expect(rating.closest(".text-rating")).not.toBeNull();
  });

  it("marks where the search matched", () => {
    mount({ ...ALL, search: "broke" });
    const marks = document.querySelectorAll("[data-review-match]");
    expect([...marks].map((mark) => mark.textContent)).toEqual(["broke"]);
  });

  it("searches once the seller pauses typing, from page 1", () => {
    vi.useFakeTimers();
    try {
      mount();
      fireEvent.change(screen.getByRole("searchbox", { name: "Search reviews" }), { target: { value: "wobbly" } });
      expect(replace).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(TYPING_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledWith("/products/reviews?q=wobbly", { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the search and filters when switching tabs", () => {
    mount({ ...ALL, search: "mug", rating: 1 });
    const tab = screen.getByRole("link", { name: /Hidden/ });
    expect(tab).toHaveAttribute("href", "/products/reviews?filter=hidden&q=mug&rating=1");
  });

  it("says when nothing matches, and offers to clear the filters", () => {
    mount({ ...ALL, search: "zzz", origin: "imported" }, []);
    expect(screen.getByText("No reviews match")).toBeInTheDocument();
    const clear = screen.getAllByRole("button", { name: "Clear filters" });
    fireEvent.click(clear[clear.length - 1]!);
    expect(replace).toHaveBeenCalledWith("/products/reviews", { scroll: false });
  });

  it("labels each review with where it stands", () => {
    mount(ALL, [
      review({ id: "a", moderation: "held", ground: "scam" }),
      review({ id: "b", moderation: "blocked", ground: "spam", source: "judgeme", verified: false }),
      review({ id: "c", hiddenReason: "personal_info" }),
    ]);
    expect(document.querySelector('[data-review="a"] [data-review-status="held"]')).toHaveTextContent(
      "Waiting for you · scam",
    );
    expect(document.querySelector('[data-review="b"] [data-review-status="blocked"]')).toHaveTextContent(
      "Blocked by the check · spam or advertising",
    );
    expect(document.querySelector('[data-review="b"]')).toHaveTextContent("Imported from Shopify (Judge.me)");
    expect(document.querySelector('[data-review="c"]')).toHaveTextContent("Hidden: Shares personal details");
    // A held review is the one that needs the seller: its Publish is the primary action.
    expect(within(document.querySelector('[data-review="a"]') as HTMLElement).getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("counts what the view holds", () => {
    mount(ALL, [review({ id: "a" }), review({ id: "b" })]);
    expect(screen.getByText("2 reviews")).toBeInTheDocument();
  });
});
