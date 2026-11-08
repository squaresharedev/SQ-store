"use client";

import { Fragment, useTransition } from "react";
import Link from "@/components/ui/AppLink";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Banknote,
  CircleDot,
  FileEdit,
  ListFilter,
  MessageSquareQuote,
  Plus,
  Search,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";
import {
  MODERATED_FILTER,
  type Product,
  type ProductFilters,
  type ProductSalesSummary,
  type ProductStatus,
} from "@/types/product";
import type { StorefrontPlacement } from "@/lib/products/queries";
import { NEW_PRODUCT_PATH, PRODUCTS_IMPORT_PATH } from "@/lib/products/paths";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import type { Paginated } from "@/types/pagination";
import { PRODUCT_SORTS, type ProductSort } from "@/lib/products/sort";
import { FilterMenu } from "@/components/ui/FilterMenu";
import type { FilterOption } from "@/components/ui/FilterOptionList";
import { useSearch } from "@/components/search/SearchProvider";
import { SortSlidersIcon } from "@/components/ui/SortSlidersIcon";
import { Spinner } from "@/components/ui/spinner";
import { UploadIcon } from "@/components/ui/UploadIcon";
import { REVIEWS_PATH } from "@/lib/reviews/paths";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import {
  helpTextClass,
  infoTextClass,
  inlineLinkClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { ConnectAiHint } from "./ConnectAiHint";
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
// and a resync-on-back/forward. The toolbar's Search button opens that search
// instead, so it is found where a seller looks for it. Status and ordering
// share ONE trigger (FilterMenu), so what remains is a menu, a Clear and the
// CTA.
//
// The `search` filter still exists in the QUERY layer — the storefront
// designer's product picker runs on it (lib/products/picker-actions). It is
// only the page's own box, and its `?q=` param, that are gone.

// Labels come from `Products.browser.sort.<value>` and `Products.status.*`.
const SORT_ICONS: { value: ProductSort; icon: FilterOption<ProductSort>["icon"] }[] = [
  { value: "default", icon: SlidersHorizontal },
  { value: "unitsSold", icon: ShoppingBag },
  { value: "revenue", icon: Banknote },
  { value: "priceHigh", icon: ArrowDownWideNarrow },
  { value: "priceLow", icon: ArrowUpNarrowWide },
  { value: "title", icon: ArrowDownAZ },
];

/** The toolbar's secondary buttons, the CTA's height beside it. */
const toolbarButtonClass = cn(secondaryButtonClass, "h-10 shrink-0 px-3 py-2 text-sm");

/** A one-line note between the toolbar and the grid. */
const listNoteClass = cn(infoTextClass, "mb-4");

/** Build the products URL from the current view. Defaults are omitted so a
 *  plain /products stays clean and shareable. */
function buildQuery(
  filters: ProductFilters,
  sort: ProductSort,
  page: number,
): string {
  const params = new URLSearchParams();
  const status = filters.moderated ? MODERATED_FILTER : filters.status;
  if (status) params.set("status", status);
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
  placements = {},
  toShip = {},
  missingTraderDetails = [],
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
  /**
   * Storefronts each product appears on, keyed by product id. Optional so
   * callers can omit it while the query is wired up; the delete dialog and
   * link affordances degrade gracefully to count 0 in that case.
   */
  placements?: Record<string, StorefrontPlacement[]>;
  /** Orders still to ship, by product id (lib/orders/queries.ts toShipByProduct). */
  toShip?: Record<string, number>;
  /** Trader details the store still owes buyers (for the buy button dialog). */
  missingTraderDetails?: readonly TraderIdentityField[];
  /** Server-rendered page title block, kept out of this client boundary. */
  heading: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Products");
  const tSearch = useTranslations("Search.trigger");
  const tPagination = useTranslations("Common.pagination");
  const search = useSearch();

  const sortOptions: FilterOption<ProductSort>[] = SORT_ICONS.map(({ value, icon }) => ({
    value,
    label: t(`browser.sort.${value}`),
    icon,
  }));
  const statusOptions: FilterOption<ProductStatus | typeof MODERATED_FILTER | "">[] = [
    { value: "", label: t("browser.allStatuses"), icon: ListFilter },
    { value: "active", label: t("status.active"), icon: CircleDot, tone: "text-success" },
    { value: "draft", label: t("status.draft"), icon: FileEdit, tone: "text-muted-foreground" },
    // Checking, in review, paused and removed together: whatever buyers
    // cannot see because of moderation, gathered in one place to work through.
    { value: MODERATED_FILTER, label: t("browser.moderated"), icon: ShieldAlert },
  ];

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
    navigate(value === MODERATED_FILTER ? { moderated: true } : { status }, sort, 1);
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
  const filtered = filters.status !== undefined || filters.moderated === true;
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
            grid below it. Desktop: hugs its content beside the heading. Wraps
            at every width rather than run past a narrow content column. */}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          {/* Universal search, from where a seller looks for it on this page:
              it finds any product by name and opens it. */}
          {showToolbar && search && (
            <button
              type="button"
              onClick={search.open}
              aria-haspopup="dialog"
              aria-expanded={search.isOpen}
              className={toolbarButtonClass}
            >
              <Search className="size-4" strokeWidth={2} aria-hidden="true" />
              {tSearch("label")}
            </button>
          )}
          {showToolbar && (
            <FilterMenu
              ariaLabel={t("browser.filterLabel")}
              restingLabel={t("browser.sortResting")}
              sections={[
                {
                  label: t("browser.statusSection"),
                  value: filters.moderated ? MODERATED_FILTER : (filters.status ?? ""),
                  options: statusOptions,
                  onChange: handleStatus,
                  defaultValue: "",
                },
                {
                  label: t("browser.sortSection"),
                  value: sort,
                  options: sortOptions,
                  onChange: handleSort,
                  defaultValue: "default",
                },
              ]}
              // Always the sliders icon (not the selected option's): it is the
              // control's identity, and its handles animate on hover.
              triggerIcon={<SortSlidersIcon className="size-4 shrink-0" />}
              // h-10 on both controls: the outlined trigger's border would
              // otherwise make it 2px taller than the CTA. The label shows at
              // every width, a phone included: a sliders icon alone is not
              // something every seller reads as "filter". `max-w-[13rem]`
              // keeps a two-group summary from crowding the CTA: it
              // truncates, the panel and the tooltip carry the full text.
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
            <button type="button" onClick={handleClear} className={toolbarButtonClass}>
              {t("browser.clear")}
            </button>
          )}
          {/* Every member reads the store's reviews; the page itself decides
              who may hide or publish them. */}
          <Link href={REVIEWS_PATH} className={toolbarButtonClass} data-products-reviews-link="">
            <MessageSquareQuote className="size-4" strokeWidth={2} aria-hidden="true" />
            {t("browser.reviews")}
          </Link>
          {canWrite ? (
            <>
              {/* Beside "Add product", not buried in a menu: someone arriving
                  with a catalogue elsewhere is deciding whether this is worth
                  the typing, and that is exactly when they need to find it. */}
              <Link href={PRODUCTS_IMPORT_PATH} className={toolbarButtonClass}>
                <UploadIcon className="size-4" />
                {t("browser.import")}
              </Link>
              <Link href={NEW_PRODUCT_PATH} className={`${primaryButtonClass} h-10 shrink-0`}>
                <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
                {t("browser.add")}
              </Link>
            </>
          ) : (
            // Where the add and import buttons would be, the reason they are
            // not: a missing control with no word of why reads as a fault.
            <p className={cn(infoTextClass, "max-w-xs")} data-products-view-only="">
              {t("browser.viewOnlyHint")}
            </p>
          )}
        </div>
      </div>

      {/* Several drafts in view, say after an import: the way to publish them
          all at once rather than one card menu at a time. */}
      {canWrite && filters.status === "draft" && data.total > 1 && (
        <p className={listNoteClass} data-products-bulk-hint="">
          <ConnectAiHint />
        </p>
      )}

      {/* The sort above orders this list only. The order buyers see is where
          the tiles sit on a storefront, said here where a seller looks for a
          way to reorder. */}
      {canWrite && !filtered && data.total > 0 && (
        <p className={listNoteClass}>
          {t.rich("browser.orderHint", {
            link: (chunks) => (
              <Link href={STOREFRONT_LIST_PATH} className={inlineLinkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

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
              {t("browser.updating")}
            </span>
          </div>
        )}

        <ProductList
          products={data.rows}
          canWrite={canWrite}
          sales={sales}
          placements={placements}
          toShip={toShip}
          missingTraderDetails={missingTraderDetails}
          filtered={filtered}
          onClearFilters={handleClear}
        />

        {totalPages > 1 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className={helpTextClass}>
              {t("browser.pagination", {
                total: data.total,
                page: data.page,
                pages: totalPages,
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={data.page <= 1}
                onClick={() => handlePage(data.page - 1)}
              >
                {tPagination("previous")}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={data.page >= totalPages}
                onClick={() => handlePage(data.page + 1)}
              >
                {tPagination("next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
