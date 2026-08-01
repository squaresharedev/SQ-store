"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Banknote,
  CircleDot,
  FileEdit,
  ListFilter,
  Plus,
  Search,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";
import type {
  Product,
  ProductFilters,
  ProductSalesSummary,
  ProductStatus,
} from "@/types/product";
import type { Paginated } from "@/types/pagination";
import type { ProductSort } from "@/lib/products/sort";
import { FilterSelect, type FilterOption } from "@/components/orders/FilterSelect";
import { SortSlidersIcon } from "@/components/ui/SortSlidersIcon";
import { Spinner } from "@/components/ui/spinner";
import {
  fieldBaseClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { ProductList } from "./ProductList";

// Owns the products page toolbar + paging. Search/status/sort/page live in the
// URL (the server page reads them and re-queries), so this component only
// wires toolbar -> URL -> list. No data access here. The heading itself stays
// a server-rendered node passed in as `heading`.

/** Matches the orders toolbar, so typing feels the same on both pages. */
const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS: FilterOption<ProductSort>[] = [
  { value: "default", label: "Newest first", icon: SlidersHorizontal },
  { value: "unitsSold", label: "Units sold", icon: ShoppingBag },
  { value: "revenue", label: "Total value sold", icon: Banknote },
  { value: "priceHigh", label: "Price: high to low", icon: ArrowDownWideNarrow },
  { value: "priceLow", label: "Price: low to high", icon: ArrowUpNarrowWide },
  { value: "title", label: "Name: A–Z", icon: ArrowDownAZ },
];

const STATUS_OPTIONS: FilterOption<ProductStatus | "">[] = [
  { value: "", label: "All statuses", icon: ListFilter },
  { value: "active", label: "Active", icon: CircleDot, tone: "text-success" },
  { value: "draft", label: "Draft", icon: FileEdit, tone: "text-muted-foreground" },
];

/** Build the products URL from the current view. Defaults are omitted so a
 *  plain /products stays clean and shareable. */
function buildQuery(
  filters: ProductFilters,
  sort: ProductSort,
  page: number,
): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (sort !== "default") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function hasAnyFilter(filters: ProductFilters): boolean {
  return Boolean(filters.search || filters.status);
}

export function ProductsBrowser({
  data,
  filters,
  sort,
  canWrite,
  sales,
  heading,
}: {
  data: Paginated<Product>;
  /** Filters the server actually applied, parsed from the URL. */
  filters: ProductFilters;
  sort: ProductSort;
  /** Whether the active account's role may edit/delete (hides those controls). */
  canWrite: boolean;
  /** Per-product paid-order rollup + bestseller, fetched server-side. */
  sales: ProductSalesSummary;
  /** Server-rendered page title block, kept out of this client boundary. */
  heading: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Local echo of the search box so typing is instant while the URL (and the
  // server re-query) catches up debounced.
  const [draft, setDraft] = useState<ProductFilters>(filters);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back/forward changes the props; resync the toolbar. Adjusted during render
  // (React's documented pattern for derived resets) rather than in an effect.
  const filtersKey = JSON.stringify(filters);
  const [syncedKey, setSyncedKey] = useState(filtersKey);
  if (syncedKey !== filtersKey) {
    setSyncedKey(filtersKey);
    setDraft(filters);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // The grid below is stale until the server responds. `isPending` covers the
  // round trip; `queued` covers the debounce window before it starts.
  const [isPending, startTransition] = useTransition();
  const [queued, setQueued] = useState(false);
  const busy = queued || isPending;

  function navigate(next: ProductFilters, nextSort: ProductSort, page: number) {
    setQueued(false);
    startTransition(() => {
      router.replace(`${pathname}${buildQuery(next, nextSort, page)}`, {
        scroll: false,
      });
    });
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    const next = { ...draft, search: value === "" ? undefined : value };
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQueued(true);
    // Any filter change restarts at page 1.
    debounceRef.current = setTimeout(() => navigate(next, sort, 1), SEARCH_DEBOUNCE_MS);
  }

  function handleStatus(value: ProductStatus | "") {
    const next = { ...draft, status: value === "" ? undefined : value };
    setDraft(next);
    navigate(next, sort, 1);
  }

  function handleSort(value: ProductSort) {
    navigate(draft, value, 1);
  }

  function handlePage(page: number) {
    navigate(draft, sort, page);
  }

  function handleClear() {
    setDraft({});
    navigate({}, sort, 1);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = hasAnyFilter(filters);
  // The toolbar stays available whenever the seller has products OR is
  // filtering: hiding it on a no-results page would strand them there.
  const showToolbar = data.total > 0 || filtered;

  return (
    <>
      {/* items-end from sm up drops the actions onto the description's line
          instead of the h1's top edge. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 sm:items-end">
        {/* Keyed wrapper, not decoration. `heading` is an element built in a
            Server Component and handed over as a PROP, so React's JSX runtime
            never key-validates it — it crosses the RSC boundary with no key and
            `_store.validated === 0`. Sitting here as one of two children, it
            gets reconciled as an array, and React demands a key of every array
            member: "Each child in a list should have a unique key prop... it
            was passed a child from ProductsPage". The key belongs on this
            wrapper rather than on the element in page.tsx, because it is this
            array that creates the requirement. Renders no DOM. */}
        <Fragment key="heading">{heading}</Fragment>
        {/* Mobile: own full-width row, so the CTA lands on the right edge of the
            grid below it. Desktop: hugs its content beside the heading. */}
        <div className="flex w-full flex-nowrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
          {showToolbar && (
            <FilterSelect
              ariaLabel="Sort products"
              variant="button"
              value={sort}
              options={SORT_OPTIONS}
              onChange={handleSort}
              // Resting state reads as the control it is; once the seller picks
              // an ordering the trigger shows that instead.
              triggerLabel={sort === "default" ? "Sort" : undefined}
              // Always the sliders icon (not the selected option's): it is the
              // control's identity, and its handles animate on hover.
              triggerIcon={<SortSlidersIcon className="size-4 shrink-0" />}
              iconOnlyOnMobile
              // h-10 on both controls: the outlined trigger's border would
              // otherwise make it 2px taller than the CTA, and the icon-only
              // mobile state 2px shorter.
              // `group/sort` is the hover/focus scope the handle motion keys off.
              triggerClassName="group/sort h-10 shrink-0"
              panelClassName="sm:w-60"
            />
          )}
          {canWrite && (
            <Link href="/products/new" className={`${primaryButtonClass} h-10 shrink-0`}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Add product
            </Link>
          )}
        </div>
      </div>

      {showToolbar && (
        <div
          role="search"
          aria-label="product filters"
          className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-xs">
            <label htmlFor="products-search" className="sr-only">
              Search products by name
            </label>
            <div className="relative flex items-center">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
              />
              <input
                type="text"
                id="products-search"
                placeholder="search by name"
                value={draft.search ?? ""}
                onChange={handleSearch}
                className={cn(fieldBaseClass, "!py-2 h-10 pl-9")}
              />
            </div>
          </div>

          <FilterSelect
            id="products-status"
            ariaLabel="Filter by status"
            value={draft.status ?? ""}
            options={STATUS_OPTIONS}
            mutedValue=""
            onChange={handleStatus}
            triggerClassName="h-10 w-40"
          />

          {filtered && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(secondaryButtonClass, "h-10 px-3 py-2 text-sm")}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Results region. While a re-query is in flight the current cards stay
          put (no layout jump) but dim and stop taking clicks. */}
      <div
        aria-busy={busy}
        className={cn(
          "relative transition-opacity duration-base ease-standard motion-reduce:transition-none",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-[0.375rem] border border-border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
            <Spinner className="size-3.5 text-muted-foreground" />
            <span className="font-inter text-xs text-muted-foreground">
              Updating…
            </span>
          </div>
        )}

        <ProductList
          products={data.rows}
          canWrite={canWrite}
          sales={sales}
          filtered={filtered}
          onClearFilters={handleClear}
        />

        {totalPages > 1 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="font-inter text-sm text-muted-foreground">
              {data.total} product{data.total === 1 ? "" : "s"} · page {data.page}{" "}
              of {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={data.page <= 1}
                onClick={() => handlePage(data.page - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={data.page >= totalPages}
                onClick={() => handlePage(data.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
