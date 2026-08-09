import type { Metadata } from "next";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { DEFAULT_PAGE_SIZE, getOrderById, listOrders } from "@/lib/orders/queries";
import { OrdersPage } from "@/components/orders/OrdersPage";
import {
  ORDERS_SEARCH_MAX_LENGTH,
  type OrderChannel,
  type OrderFilters,
  type OrderSort,
  type OrderStatus,
} from "@/types/order-view";

export const metadata: Metadata = {
  title: "Orders",
};

// PROTECTED by (dashboard)/layout.tsx. Reads are owner-scoped (session + RLS)
// and strictly read-only against orders. Filters/sort/page live in the URL so
// views are shareable and back/forward works.
//
// `?order=<id>` opens that order's detail panel. It is fetched by id rather
// than looked up in the current page of rows, so the link works whatever the
// filters, sort or page happen to be (the dashboard's Recent orders card links
// here, and its newest five are not necessarily on page 1 of a filtered view).
//
// `?highlight=<id>` is the QUIETER arrival, and the one universal search uses:
// it marks that order's row and focuses it, opening nothing. Two params rather
// than one flag because they are two different intents — "show me this order"
// and "take me into this order" — and the caller is the only one who knows
// which it meant. Unlike `order`, this needs no fetch: the id is only ever
// compared against the rows already on screen.

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
  // `?q=` is the one filter that is free text rather than a known literal, and
  // it is reachable by anyone who can edit a URL — so it is bounded here, at
  // the parse boundary, like every other param. The cap also governs what gets
  // echoed back into the toolbar input as its value. Control characters are
  // dropped for the same reason every other free-text field rejects them; here
  // they can only have arrived by hand.
  const search = first(params.q)
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, ORDERS_SEARCH_MAX_LENGTH);
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
  const params = await searchParams;
  const { filters, sort, page } = parseParams(params);
  const deepLinkedId = first(params.order);

  const [data, deepLinked] = await Promise.all([
    listOrders({ filters, sort, page, pageSize: DEFAULT_PAGE_SIZE }),
    // A stale or foreign id resolves to null: the list still renders, just
    // without a detail panel.
    deepLinkedId ? getOrderById(deepLinkedId) : Promise.resolve(null),
  ]);

  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title="Orders"
        subtitle="Every sale across your embed and the marketplace."
      />
      <OrdersPage
        data={data}
        filters={filters}
        sort={sort}
        deepLinkedOrder={deepLinked}
        highlightId={first(params.highlight) ?? null}
      />
    </main>
  );
}
