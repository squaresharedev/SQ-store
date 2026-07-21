"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Banknote,
  Plus,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";
import type { Product, ProductSalesSummary } from "@/types/product";
import type { ProductSort } from "@/lib/products/sort";
import { FilterSelect, type FilterOption } from "@/components/orders/FilterSelect";
import { primaryButtonClass } from "@/components/ui/control-styles";
import { ProductList } from "./ProductList";

// Owns the products page header actions + the grid ordering. Client-side
// because the sort control and the list must share state; the heading itself
// stays a server-rendered node passed in as `heading`.

const SORT_OPTIONS: FilterOption<ProductSort>[] = [
  { value: "default", label: "Newest first", icon: SlidersHorizontal },
  { value: "unitsSold", label: "Units sold", icon: ShoppingBag },
  { value: "revenue", label: "Total value sold", icon: Banknote },
  { value: "priceHigh", label: "Price: high to low", icon: ArrowDownWideNarrow },
  { value: "priceLow", label: "Price: low to high", icon: ArrowUpNarrowWide },
  { value: "title", label: "Name: A–Z", icon: ArrowDownAZ },
];

export function ProductsBrowser({
  products,
  canWrite,
  sales,
  heading,
}: {
  products: Product[];
  /** Whether the active account's role may edit/delete (hides those controls). */
  canWrite: boolean;
  /** Per-product paid-order rollup + bestseller, fetched server-side. */
  sales: ProductSalesSummary;
  /** Server-rendered page title block, kept out of this client boundary. */
  heading: React.ReactNode;
}) {
  // The ordering lives here (the control is here) but is APPLIED inside
  // ProductList, which owns the live list — otherwise an optimistic delete and
  // a re-sort would fight over which array wins.
  const [sort, setSort] = useState<ProductSort>("default");

  return (
    <>
      {/* items-end from sm up drops the actions onto the description's line
          instead of the h1's top edge. */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 sm:items-end">
        {heading}
        {/* Mobile: own full-width row, so the CTA lands on the right edge of the
            grid below it. Desktop: hugs its content beside the heading. Never
            wraps internally — the two controls stay side by side at every width. */}
        <div className="flex w-full flex-nowrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
          {/* No products yet = nothing to order; the empty state carries the page. */}
          {products.length > 0 && (
            <FilterSelect
              ariaLabel="Sort products"
              variant="button"
              value={sort}
              options={SORT_OPTIONS}
              onChange={setSort}
              // Resting state reads as the control it is; once the seller picks
              // an ordering the trigger shows that instead.
              triggerLabel={sort === "default" ? "Sort" : undefined}
              iconOnlyOnMobile
              // h-10 on both controls: the outlined trigger's border would
              // otherwise make it 2px taller than the CTA, and the icon-only
              // mobile state 2px shorter.
              triggerClassName="h-10 shrink-0"
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

      <ProductList products={products} canWrite={canWrite} sales={sales} sort={sort} />
    </>
  );
}
