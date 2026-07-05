import type { Metadata } from "next";
import { DEFAULT_PAGE_SIZE, listOrders } from "@/lib/orders/queries";
import { OrdersPage } from "@/components/orders/OrdersPage";
import type {
  OrderChannel,
  OrderFilters,
  OrderSort,
  OrderStatus,
} from "@/types/order-view";

export const metadata: Metadata = {
  title: "Orders",
};

// PROTECTED by (dashboard)/layout.tsx. Reads are owner-scoped (session + RLS)
// and strictly read-only against orders. Filters/sort/page live in the URL so
// views are shareable and back/forward works.

type SearchParams = { [key: string]: string | string[] | undefined };

const STATUSES: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];
const CHANNELS: OrderChannel[] = ["embed", "marketplace"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Whitelist-parse the URL params; anything malformed is simply dropped. */
function parseParams(params: SearchParams): {
  filters: OrderFilters;
  sort: OrderSort;
  page: number;
} {
  const filters: OrderFilters = {};

  const status = first(params.status);
  if (STATUSES.includes(status as OrderStatus)) {
    filters.status = status as OrderStatus;
  }
  const channel = first(params.channel);
  if (CHANNELS.includes(channel as OrderChannel)) {
    filters.channel = channel as OrderChannel;
  }
  const from = first(params.from);
  if (from && ISO_DATE.test(from)) filters.dateFrom = from;
  const to = first(params.to);
  if (to && ISO_DATE.test(to)) filters.dateTo = to;
  const search = first(params.q)?.trim();
  if (search) filters.search = search;

  const sortField = first(params.sort);
  const sortDir = first(params.dir);
  const sort: OrderSort = {
    field: sortField === "amount" ? "amount" : "createdAt",
    direction: sortDir === "asc" ? "asc" : "desc",
  };

  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const page = Number.isNaN(parsedPage) ? 1 : Math.max(1, parsedPage);

  return { filters, sort, page };
}

export default async function OrdersRoutePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { filters, sort, page } = parseParams(await searchParams);
  const data = await listOrders({
    filters,
    sort,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Orders
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Every sale across your embed and the marketplace.
        </p>
      </div>
      <OrdersPage data={data} filters={filters} sort={sort} />
    </main>
  );
}
