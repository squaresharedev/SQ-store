"use client";

import { Fragment, useTransition } from "react";
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
  ShoppingBag,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import type {
  Product,
  ProductFilters,
  ProductSalesSummary,
  ProductStatus,
} from "@/types/product";
import type { Paginated } from "@/types/pagination";
import { PRODUCT_SORTS, type ProductSort } from "@/lib/products/sort";
import { FilterMenu } from "@/components/ui/FilterMenu";
import type { FilterOption } from "@/components/ui/FilterOptionList";
import { SortSlidersIcon } from "@/components/ui/SortSlidersIcon";
import { Spinner } from "@/components/ui/spinner";
import { helpTextClass, infoTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { ProductList } from "./ProductList";

// Owns the products page toolbar + paging. Status/sort/page live in the URL
// (the server page reads them and re-queries), so this component only wires
// toolbar -> URL -> list. No data access here. The heading itself stays a
// server-rendered node passed in as `heading`.
//
// NO SEARCH BOX. Finding a product by name is universal search's job (⌘K,
// which reaches products from anywhere and goes straight to the one you
// picked); a second field doing a worse version of it on this page alone was
// the only reason this component held a debounce, a draft copy of the filters
// and a resync-on-back/forward. Status and ordering share ONE trigger
// (FilterMenu), so what remains is a menu, a Clear and the CTA.
//
// The `search` filter still exists in the QUERY layer — the storefront
// designer's product picker runs on it (lib/products/picker-actions). It is
// only the page's own box, and its `?q=` param, that are gone.

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
  if (filters.status) params.set("status", filters.status);
  if (sort !== "default") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
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

  // Every remaining control navigates on the spot (no typing to debounce), so
  // the URL is the only copy of the view: no draft state, and nothing to
  // resync when back/forward changes the props. `isPending` alone covers the
  // busy treatment now — the `queued` flag it used to pair with existed only
  // to cover the search box's debounce window.
  const [isPending, startTransition] = useTransition();

  function navigate(next: ProductFilters, nextSort: ProductSort, page: number) {
    startTransition(() => {
      router.replace(`${pathname}${buildQuery(next, nextSort, page)}`, {
        scroll: false,
      });
    });
  }

  // Both handlers take a plain string and narrow: the merged menu holds two
  // groups of different value types, and these values round-trip through the
  // URL, so a runtime check is the honest boundary rather than a cast.
  function handleStatus(value: string) {
    const status: ProductStatus | undefined =
      value === "active" || value === "draft" ? value : undefined;
    // Any filter change restarts at page 1.
    navigate({ status }, sort, 1);
  }

  function handleSort(value: string) {
    navigate(filters, PRODUCT_SORTS.find((option) => option === value) ?? "default", 1);
  }

  function handlePage(page: number) {
    navigate(filters, sort, page);
  }

  function handleClear() {
    navigate({}, sort, 1);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = filters.status !== undefined;
  // The toolbar stays available whenever the seller has products OR is
  // filtering: hiding it on a no-results page would strand them there.
  const showToolbar = data.total > 0 || filtered;

  return (
    <>
      {/* items-end from sm up sits the actions on the title's baseline rather
          than its top edge, which matters now the title is the tallest thing
          in the row. */}
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
            <FilterMenu
              ariaLabel="Sort and filter products"
              restingLabel="Sort"
              sections={[
                {
                  label: "Status",
                  value: filters.status ?? "",
                  options: STATUS_OPTIONS,
                  onChange: handleStatus,
                  defaultValue: "",
                },
                {
                  label: "Sort by",
                  value: sort,
                  options: SORT_OPTIONS,
                  onChange: handleSort,
                  defaultValue: "default",
                },
              ]}
              // Always the sliders icon (not the selected option's): it is the
              // control's identity, and its handles animate on hover.
              triggerIcon={<SortSlidersIcon className="size-4 shrink-0" />}
              iconOnlyOnMobile
              // h-10 on both controls: the outlined trigger's border would
              // otherwise make it 2px taller than the CTA, and the icon-only
              // mobile state 2px shorter. `max-w-[13rem]` keeps a two-group
              // summary from crowding the CTA — it truncates, the panel and the
              // tooltip carry the full text.
              // `group/sort` is the hover/focus scope the handle motion keys off.
              triggerClassName="group/sort h-10 max-w-[13rem] shrink-0"
              panelClassName="sm:w-64"
            />
          )}
          {/* Reset, kept beside the menu now the search row that used to hold
              it is gone. Only while a filter is actually on: a permanent
              Clear next to the CTA is a control that does nothing most of
              the time. The menu's own "All statuses" does the same job; this
              is the one-click version of it. */}
          {filtered && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(secondaryButtonClass, "h-10 shrink-0 px-3 py-2 text-sm")}
            >
              Clear
            </button>
          )}
          {canWrite && (
            <>
              {/* Beside "Add product", not buried in a menu: someone arriving
                  with a catalogue elsewhere is deciding whether this is worth
                  the typing, and that is exactly when they need to find it. */}
              <Link
                href="/products/import"
                className={cn(secondaryButtonClass, "h-10 shrink-0 px-3 py-2 text-sm")}
              >
                <Upload className="size-4" strokeWidth={2} aria-hidden="true" />
                Import
              </Link>
              <Link href="/products/new" className={`${primaryButtonClass} h-10 shrink-0`}>
                <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
                Add product
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Results region. While a re-query is in flight the current cards stay
          put (no layout jump) but dim and stop taking clicks. */}
      <div
        aria-busy={isPending}
        className={cn(
          "relative transition-opacity duration-base ease-standard motion-reduce:transition-none",
          isPending && "pointer-events-none opacity-60",
        )}
      >
        {isPending && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-sm border border-border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
            <Spinner className="size-3.5 text-muted-foreground" />
            <span className={infoTextClass}>
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
            <p className={helpTextClass}>
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
