import type { Metadata } from "next";
import {
  PRODUCTS_DEFAULT_PAGE_SIZE,
  getProductSales,
  listProducts,
} from "@/lib/products/queries";
import { ProductsBrowser } from "@/components/products/ProductsBrowser";
import { PRODUCT_SORTS, type ProductSort } from "@/lib/products/sort";
import { PRODUCT_STATUSES, type ProductFilters, type ProductStatus } from "@/types/product";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "Products",
};

// PROTECTED by (dashboard)/layout.tsx. Reads are account-scoped (session +
// RLS). Status/sort/page live in the URL so views are shareable and
// back/forward works, exactly like the orders list.
//
// There is no `?q=`: finding a product by name is universal search's job, so
// this page has no search box to feed one (see ProductsBrowser).

type SearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Whitelist-parse the URL params; anything malformed is simply dropped. */
function parseParams(params: SearchParams): {
  filters: ProductFilters;
  sort: ProductSort;
  page: number;
} {
  const filters: ProductFilters = {};

  const status = first(params.status);
  if (PRODUCT_STATUSES.includes(status as ProductStatus)) {
    filters.status = status as ProductStatus;
  }
  const sortParam = first(params.sort);
  const sort: ProductSort = PRODUCT_SORTS.includes(sortParam as ProductSort)
    ? (sortParam as ProductSort)
    : "default";

  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const page = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);

  return { filters, sort, page };
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { filters, sort, page } = parseParams(await searchParams);

  const [data, account, sales] = await Promise.all([
    listProducts({ filters, sort, page, pageSize: PRODUCTS_DEFAULT_PAGE_SIZE }),
    getActiveAccount(),
    getProductSales(),
  ]);
  const canWrite = can(account?.role, "products.write");

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* The toolbar and the grid share URL state, so the header actions live
          in ProductsBrowser; the title block stays server-rendered here. */}
      <ProductsBrowser
        data={data}
        filters={filters}
        sort={sort}
        canWrite={canWrite}
        sales={sales}
        heading={
          <div>
            <h1 className="text-3xl font-semibold text-foreground md:text-4xl">
              Products
            </h1>
          </div>
        }
      />
    </main>
  );
}
