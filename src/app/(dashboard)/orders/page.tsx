import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import {
  DEFAULT_PAGE_SIZE,
  countOrdersToShip,
  getOrderById,
  listOrders,
} from "@/lib/orders/queries";
import { ORDER_DETAIL_PARAM, ORDERS_VIEW_PARAM } from "@/lib/orders/paths";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { OrdersPage } from "@/components/orders/OrdersPage";
import { OrdersExportButton } from "@/components/orders/OrdersExportButton";
import { getAccountBilling } from "@/lib/billing/account-plan";
import { planHas } from "@/lib/billing/features";
import {
  ORDERS_SEARCH_MAX_LENGTH,
  ORDERS_VIEWS,
  type OrderChannel,
  type OrderFilters,
  type OrderSort,
  type OrderStatus,
  type OrdersView,
} from "@/types/order-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Orders.metadata.orders");
  return { title: t("title") };
}

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
//
// `?view=to-ship|all` picks the list (see resolveView). With no view named, the
// page opens on what needs doing: the To ship queue when anything is waiting,
// the full list when nothing is.

type SearchParams = { [key: string]: string | string[] | undefined };

const STATUSES: OrderStatus[] = ["paid", "refunded", "disputed", "pending"];
const CHANNELS: OrderChannel[] = ["embed", "marketplace", "direct"];
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

/**
 * Which list to show. A named view wins. Otherwise anything that only means
 * something in the full list (a filter, a sort, a highlighted search result)
 * implies it; and with nothing asked for, the page opens on the To ship queue
 * when there is anything in it. A seller who comes here with parcels to send
 * lands on them, and one with none lands on their history.
 */
function resolveView(
  params: SearchParams,
  filters: OrderFilters,
  toShipCount: number,
): OrdersView {
  const named = first(params[ORDERS_VIEW_PARAM]);
  const view = ORDERS_VIEWS.find((value) => value === named);
  if (view) return view;
  const asksForTheLedger =
    Object.keys(filters).length > 0 || params.sort !== undefined || params.highlight !== undefined;
  return !asksForTheLedger && toShipCount > 0 ? "to-ship" : "all";
}

export default async function OrdersRoutePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { filters, sort, page } = parseParams(params);
  const deepLinkedId = first(params[ORDER_DETAIL_PARAM]);
  const t = await getTranslations("Orders.page");

  const [toShipCount, account] = await Promise.all([countOrdersToShip(), getActiveAccount()]);
  const view = resolveView(params, filters, toShipCount);

  const [data, deepLinked, billing] = await Promise.all([
    listOrders({ view, filters, sort, page, pageSize: DEFAULT_PAGE_SIZE }),
    // A stale or foreign id resolves to null: the list still renders, just
    // without a detail panel.
    deepLinkedId ? getOrderById(deepLinkedId) : Promise.resolve(null),
    account ? getAccountBilling(account.accountId) : Promise.resolve(null),
  ]);
  // Only decides which button shows; the export route re-checks the plan.
  const canExport = billing?.ok === true && planHas(billing.billing.plan, "ordersExport");

  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={account ? <OrdersExportButton enabled={canExport} /> : null}
      />
      <OrdersPage
        view={view}
        toShipCount={toShipCount}
        canFulfil={can(account?.role, "orders.fulfil")}
        checkoutOpen={account ? checkoutProviderFor(account.accountId) !== null : false}
        data={data}
        filters={view === "all" ? filters : {}}
        sort={sort}
        deepLinkedOrder={deepLinked}
        highlightId={first(params.highlight) ?? null}
      />
    </main>
  );
}
