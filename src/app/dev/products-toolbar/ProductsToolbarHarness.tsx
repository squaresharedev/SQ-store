"use client";

import { ProductsBrowser } from "@/components/products/ProductsBrowser";
import { SearchProvider } from "@/components/search/SearchProvider";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PRODUCT_SORTS, type ProductSort } from "@/lib/products/sort";
import type { ProductFilters, ProductSalesSummary } from "@/types/product";
import { CARD_FIXTURES } from "../product-cards/fixtures";

/** The real ProductsBrowser in the real page shell's padding, over the product card fixtures. */
export function ProductsToolbarHarness({
  status,
  sort,
  viewer,
  empty,
  rail,
}: {
  status: string | null;
  sort: string | null;
  viewer: boolean;
  empty: boolean;
  /** Leave the dashboard rail's room on the left from md up, as the real shell does. */
  rail: boolean;
}) {
  const filters: ProductFilters =
    status === "moderated" ? { moderated: true } : status === "active" || status === "draft" ? { status } : {};
  const order: ProductSort = PRODUCT_SORTS.find((option) => option === sort) ?? "default";
  const rows = empty ? [] : CARD_FIXTURES.map((fixture) => fixture.product);
  const sales: ProductSalesSummary = {
    byProduct: Object.fromEntries(CARD_FIXTURES.flatMap((fixture) => (fixture.sales ? [[fixture.product.id, fixture.sales]] : []))),
    bestsellerId: null,
  };
  return (
    <SearchProvider role={viewer ? "viewer" : "owner"} accountId={null}>
      <div className={rail ? "md:pl-64" : undefined}>
        <main className={pageShellClass}>
          <ProductsBrowser
            data={{ rows, total: rows.length, page: 1, pageSize: 24 }}
            filters={filters}
            sort={order}
            canWrite={!viewer}
            sales={sales}
            heading={<h1 className="text-3xl font-semibold text-foreground md:text-4xl">Products</h1>}
          />
        </main>
      </div>
    </SearchProvider>
  );
}
