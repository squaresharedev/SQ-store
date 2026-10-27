"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  BadgeCheck,
  Download,
  ListFilter,
  Package,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBaseClass, ghostButtonClass } from "@/components/ui/control-styles";
import { FilterSelect, type FilterOption } from "@/components/orders/FilterSelect";
import { REVIEW_RATING_MAX } from "@/lib/reviews/limits";
import {
  REVIEW_ORIGIN_FILTERS,
  REVIEWS_SEARCH_MAX_LENGTH,
  SELLER_REVIEW_SORTS,
  hasReviewNarrowing,
  type ReviewOriginFilter,
  type SellerReviewFilters,
  type SellerReviewSort,
} from "@/lib/reviews/seller-filters";
import type { ReviewedProduct } from "@/lib/reviews/seller-queries";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";

/** Small muted field label, as on the Orders toolbar. */
const fieldLabelClass = "font-inter text-xs font-medium text-muted-foreground";

const SORT_ICONS: Record<SellerReviewSort, FilterOption<SellerReviewSort>["icon"]> = {
  newest: ArrowDownWideNarrow,
  oldest: ArrowUpWideNarrow,
  highest: TrendingUp,
  lowest: TrendingDown,
};

const ORIGIN_ICONS: Record<ReviewOriginFilter, FilterOption<ReviewOriginFilter>["icon"]> = {
  verified: BadgeCheck,
  imported: Download,
};

const STAR_VALUES = Array.from({ length: REVIEW_RATING_MAX }, (_, index) => String(REVIEW_RATING_MAX - index));

/**
 * Search and narrow the store's reviews. Every control writes the URL (the
 * server re-reads it), so this holds no copy of the view beyond the search
 * box's draft: typing is instant there, and the address follows once the
 * seller pauses (TYPING_DEBOUNCE_MS).
 */
export function ReviewsToolbar({
  filters,
  products,
  onChange,
}: {
  filters: SellerReviewFilters;
  products: readonly ReviewedProduct[];
  onChange: (next: SellerReviewFilters) => void;
}) {
  const t = useTranslations("Products.reviewModeration.toolbar");
  const tPage = useTranslations("ProductPage.reviews");

  // The box's own text, so typing never waits on a round trip. Reset when the
  // URL's term changes underneath it (back/forward, Clear), during render as
  // the React docs advise for derived resets.
  const [draft, setDraft] = useState(filters.search ?? "");
  const [syncedSearch, setSyncedSearch] = useState(filters.search ?? "");
  if (syncedSearch !== (filters.search ?? "")) {
    setSyncedSearch(filters.search ?? "");
    setDraft(filters.search ?? "");
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  /** Apply a change now, carrying whatever is typed in the box with it, so a
   *  term still waiting on the debounce is neither lost nor applied later
   *  over the top of this change. */
  function apply(patch: Partial<SellerReviewFilters>, search: string = draft) {
    if (debounce.current) clearTimeout(debounce.current);
    onChange({ ...filters, search: search.trim() || undefined, ...patch });
  }

  function handleSearch(value: string) {
    const term = value.slice(0, REVIEWS_SEARCH_MAX_LENGTH);
    setDraft(term);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({}, term), TYPING_DEBOUNCE_MS);
  }

  function handleClear() {
    setDraft("");
    apply({ rating: undefined, productId: undefined, origin: undefined }, "");
  }

  const ratingOptions: FilterOption<string>[] = [
    { value: "", label: t("anyRating"), icon: ListFilter },
    ...STAR_VALUES.map((value) => ({
      value,
      label: tPage("starsShort", { rating: Number(value) }),
      icon: Star,
      tone: "text-rating",
    })),
  ];
  const productOptions: FilterOption<string>[] = [
    { value: "", label: t("anyProduct"), icon: ListFilter },
    ...products.map((product) => ({ value: product.id, label: product.title, icon: Package })),
  ];
  const originOptions: FilterOption<ReviewOriginFilter | "">[] = [
    { value: "", label: t("anyOrigin"), icon: ListFilter },
    ...REVIEW_ORIGIN_FILTERS.map((value) => ({
      value,
      label: t(`origins.${value}`),
      icon: ORIGIN_ICONS[value],
      tone: value === "verified" ? "text-success" : undefined,
    })),
  ];
  const sortOptions: FilterOption<SellerReviewSort>[] = SELLER_REVIEW_SORTS.map((value) => ({
    value,
    label: t(`sorts.${value}`),
    icon: SORT_ICONS[value],
  }));

  return (
    <div
      role="search"
      aria-label={t("region")}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/50 p-4"
      data-reviews-toolbar=""
    >
      {/* The search box takes the first row whole; the filters share the next. */}
      <div className="flex basis-full flex-col gap-1.5">
        <label htmlFor="reviews-search" className={fieldLabelClass}>
          {t("search")}
        </label>
        <div className="relative flex items-center">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <input
            type="search"
            id="reviews-search"
            maxLength={REVIEWS_SEARCH_MAX_LENGTH}
            placeholder={t("searchPlaceholder")}
            value={draft}
            onChange={(event) => handleSearch(event.target.value)}
            className={cn(fieldBaseClass, "!py-2 w-full pl-9")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reviews-rating" className={fieldLabelClass}>
          {t("rating")}
        </label>
        <FilterSelect
          id="reviews-rating"
          ariaLabel={t("rating")}
          value={filters.rating ? String(filters.rating) : ""}
          options={ratingOptions}
          mutedValue=""
          onChange={(value) => apply({ rating: value ? Number(value) : undefined })}
          triggerClassName="w-36"
        />
      </div>

      {products.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reviews-product" className={fieldLabelClass}>
            {t("product")}
          </label>
          <FilterSelect
            id="reviews-product"
            ariaLabel={t("product")}
            value={filters.productId ?? ""}
            options={productOptions}
            mutedValue=""
            onChange={(value) => apply({ productId: value || undefined })}
            triggerClassName="w-48"
            panelClassName="sm:w-72"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reviews-origin" className={fieldLabelClass}>
          {t("origin")}
        </label>
        <FilterSelect
          id="reviews-origin"
          ariaLabel={t("origin")}
          value={filters.origin ?? ""}
          options={originOptions}
          mutedValue=""
          onChange={(value) => apply({ origin: value || undefined })}
          triggerClassName="w-40"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reviews-sort" className={fieldLabelClass}>
          {t("sort")}
        </label>
        <FilterSelect
          id="reviews-sort"
          ariaLabel={t("sort")}
          value={filters.sort}
          options={sortOptions}
          onChange={(sort) => apply({ sort })}
          triggerClassName="w-40"
        />
      </div>

      {(hasReviewNarrowing(filters) || draft !== "") && (
        <button
          type="button"
          onClick={handleClear}
          className={cn(ghostButtonClass, "gap-1.5 px-3 py-2")}
          data-reviews-clear=""
        >
          <X className="size-4 shrink-0" aria-hidden="true" />
          {t("clear")}
        </button>
      )}
    </div>
  );
}
