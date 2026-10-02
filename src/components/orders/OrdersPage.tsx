"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { helpTextClass, infoTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { PageTabs } from "@/components/ui/PageTabs";
import { Spinner } from "@/components/ui/spinner";
import { useTourReveal } from "@/lib/onboarding/tour-store";
import { isToShip } from "@/lib/orders/fulfilment";
import { ORDERS_VIEW_PARAM, ordersViewPath } from "@/lib/orders/paths";
import { cn } from "@/lib/utils";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";
import type {
  OrderFilters,
  OrderSort,
  OrderView,
  OrdersView,
  Paginated,
} from "@/types/order-view";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { OrdersEmptyState } from "./OrdersEmptyState";
import { OrdersTable } from "./OrdersTable";
import { OrdersToolbar, type SortValue } from "./OrdersToolbar";

// Composition only: the view, filters, sort and page live in the URL (the
// server page reads them and re-queries); this component just wires tabs ->
// toolbar -> URL -> table -> detail. No data access here.


function hasAnyFilter(filters: OrderFilters): boolean {
  return Boolean(
    filters.status ||
      filters.channel ||
      filters.dateFrom ||
      filters.dateTo ||
      (filters.search && filters.search.trim() !== ""),
  );
}

/** The URL for a list state. The view is always named once the seller has
 *  moved, so a refresh stays on the list they chose rather than on the page's
 *  own default; filters and sort only exist in the full list. */
function buildQuery(
  view: OrdersView,
  filters: OrderFilters,
  sort: OrderSort,
  page: number,
): string {
  const params = new URLSearchParams();
  params.set(ORDERS_VIEW_PARAM, view);
  if (view === "all") {
    if (filters.status) params.set("status", filters.status);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.dateFrom) params.set("from", filters.dateFrom);
    if (filters.dateTo) params.set("to", filters.dateTo);
    if (filters.search && filters.search.trim() !== "") {
      params.set("q", filters.search);
    }
    if (sort.field !== "createdAt" || sort.direction !== "desc") {
      params.set("sort", sort.field);
      params.set("dir", sort.direction);
    }
  }
  if (page > 1) params.set("page", String(page));
  return `?${params.toString()}`;
}

export function OrdersPage({
  view,
  toShipCount,
  canFulfil = false,
  checkoutOpen = false,
  data,
  filters,
  sort,
  deepLinkedOrder = null,
  highlightId = null,
}: {
  /** Which list is showing (resolved by the page; see resolveView there). */
  view: OrdersView;
  /** Orders waiting to be shipped, for the To ship tab's count. */
  toShipCount: number;
  /** Whether the viewer may mark orders shipped. */
  canFulfil?: boolean;
  /** Whether a buyer can pay through Square Share checkout right now. It
   *  decides what an empty list says (see OrdersEmptyState). */
  checkoutOpen?: boolean;
  data: Paginated<OrderView>;
  filters: OrderFilters;
  sort: OrderSort;
  /** Order named by `?order=<id>`; its detail panel opens on arrival. */
  deepLinkedOrder?: OrderView | null;
  /** Order named by `?highlight=<id>` (universal search): its row is marked
   *  and focused, and NOTHING opens. Only the id, because the row is already
   *  on screen — if it is not, nothing highlights and the list is just a list.
   *  It survives until the next navigation: buildQuery never emits the param,
   *  so the first filter, sort or page change drops the marker with it. */
  highlightId?: string | null;
}) {
  const t = useTranslations("Orders");
  const tCommon = useTranslations("Common.pagination");
  const router = useRouter();
  const pathname = usePathname();

  // Local echo of the filters so typing in the search box is instant while the
  // URL (and server re-query) catches up debounced.
  const [draft, setDraft] = useState<OrderFilters>(filters);
  const [selected, setSelected] = useState<OrderView | null>(deepLinkedOrder);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Every filter/sort/page change re-queries on the SERVER, so the table below
  // is stale until new props arrive. `isPending` covers the round trip;
  // `queued` covers the debounce window before it starts, so a search keystroke
  // reads as busy immediately instead of sitting still for 300ms and then
  // flashing. Together they gate one quiet "working" treatment.
  const [isPending, startTransition] = useTransition();
  const [queued, setQueued] = useState(false);
  const busy = queued || isPending;

  // External navigation (back/forward) changes the props; resync the toolbar.
  // State is adjusted during render (not in an effect) per the React docs
  // pattern for derived resets.
  const filtersKey = JSON.stringify(filters);
  const [syncedKey, setSyncedKey] = useState(filtersKey);
  if (syncedKey !== filtersKey) {
    setSyncedKey(filtersKey);
    setDraft(filters);
  }

  // Same derived-reset pattern for the deep link: landing on (or navigating
  // to) /orders?order=<id> opens that order's panel.
  const deepLinkedId = deepLinkedOrder?.id ?? null;
  const [syncedOrderId, setSyncedOrderId] = useState(deepLinkedId);
  if (syncedOrderId !== deepLinkedId) {
    setSyncedOrderId(deepLinkedId);
    setSelected(deepLinkedOrder);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Pin the list the page chose into the address. With no `?view=` the server
  // opens on the To ship queue while anything is waiting, and on the full list
  // when nothing is, so a refresh after shipping the last parcel would flip the
  // seller from the queue to the ledger under them. Naming the view once they
  // have arrived makes a refresh, a shared link and the back button all stay
  // where they were. replaceState, not router.replace: nothing needs to be
  // re-queried, and it adds no history entry.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has(ORDERS_VIEW_PARAM)) return;
    url.searchParams.set(ORDERS_VIEW_PARAM, view);
    window.history.replaceState(null, "", url);
  }, [view]);

  /** Go to a URL inside the busy treatment (see above). */
  const go = useCallback(
    (href: string) => {
      setQueued(false);
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router],
  );

  /** Filters, sort and page all belong to the full list, so any of them
   *  lands there: filtering from the To ship queue is asking about history. */
  const navigate = useCallback(
    (next: OrderFilters, nextSort: OrderSort, page: number, nextView: OrdersView = "all") => {
      go(`${pathname}${buildQuery(nextView, next, nextSort, page)}`);
    },
    [go, pathname],
  );

  /** Close the panel, and drop `?order=` with it — otherwise a refresh (or the
   *  next filter change, which rebuilds the URL) would reopen it. buildQuery
   *  never emits that param, so re-navigating is the whole fix. */
  function closeDetail() {
    setSelected(null);
    if (deepLinkedId) navigate(draft, sort, data.page, view);
  }

  function handleFilters(next: OrderFilters) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const searchOnlyChange =
      next.search !== draft.search &&
      next.status === draft.status &&
      next.channel === draft.channel &&
      next.dateFrom === draft.dateFrom &&
      next.dateTo === draft.dateTo;
    setDraft(next);
    // Any filter change restarts at page 1.
    if (searchOnlyChange) {
      setQueued(true);
      debounceRef.current = setTimeout(() => navigate(next, sort, 1), TYPING_DEBOUNCE_MS);
    } else {
      navigate(next, sort, 1);
    }
  }

  function handleSort(value: SortValue) {
    const [field, direction] = value.split("-") as [
      OrderSort["field"],
      OrderSort["direction"],
    ];
    navigate(draft, { field, direction }, 1);
  }

  function handlePage(page: number) {
    navigate(draft, sort, page, view);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = hasAnyFilter(draft);
  // An account that has never had an order has nothing to filter, and a full
  // toolbar over an empty list is chrome for data that does not exist (the
  // products list hides its toolbar the same way). Judged on the SERVER's
  // filters rather than the draft, so a filter being typed into never makes
  // the toolbar vanish under the cursor.
  const toShip = view === "to-ship";
  const accountEmpty = !toShip && toShipCount === 0 && data.total === 0 && !hasAnyFilter(filters);
  // Except while the guided tour is pointing at it: a new seller has no orders,
  // and a tour stop about search and filters needs the real ones on screen
  // (lib/onboarding/tour-steps.ts). It hides again when the tour moves on.
  const tourShowsToolbar = useTourReveal("orders-toolbar");

  // Clearing the queue: the panel offers the next parcel, so working through
  // the To ship list is one press per order instead of close, find, open. The
  // list re-queries after each ship, so the order just sent has already left
  // `data.rows`; it is excluded by id anyway for the moment before it has.
  // `remaining` counts what is still owed beyond the open order, including
  // rows on other pages, so "caught up" is only said when it is true.
  const nextOrder =
    toShip && selected
      ? (data.rows.find((row) => row.id !== selected.id && isToShip(row)) ?? null)
      : null;
  const remaining = data.total - (selected && data.rows.some((row) => row.id === selected.id) ? 1 : 0);
  const queueDone = toShip && selected !== null && remaining <= 0;

  return (
    <div className="space-y-4">
      {/* The two lists. Hidden only for an account with no orders at all,
          where there is nothing to switch between. */}
      {!accountEmpty && (
        <PageTabs
          ariaLabel={t("views.label")}
          onNavigate={go}
          tabs={[
            {
              href: ordersViewPath("to-ship"),
              label: t("views.toShip"),
              active: toShip,
              count: toShipCount,
              countLabel: t("toShipCount", { count: toShipCount }),
            },
            { href: ordersViewPath("all"), label: t("views.all"), active: !toShip },
          ]}
        />
      )}

      {((!toShip && !accountEmpty) || tourShowsToolbar) && (
        <OrdersToolbar
          filters={draft}
          onChange={handleFilters}
          sort={sort}
          onSortChange={handleSort}
        />
      )}

      {/* Results region. While a re-query is in flight the current rows stay
          put (no layout jump, nothing to re-read) but dim and stop taking
          clicks, and a small spinner names what's happening. aria-busy lets
          assistive tech announce the same thing. */}
      <div
        aria-busy={busy}
        className={cn(
          "relative transition-opacity duration-base ease-standard motion-reduce:transition-none",
          busy && "pointer-events-none opacity-60",
        )}
      >
        {busy && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-sm border border-border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
            <Spinner className="size-3.5 text-muted-foreground" />
            <span className={infoTextClass}>
              {t("list.updating")}
            </span>
          </div>
        )}

        {data.rows.length === 0 ? (
          <OrdersEmptyState
            filtered={filtered}
            onClear={() => handleFilters({})}
            toShip={toShip}
            onSeeAll={() => go(ordersViewPath("all"))}
            checkoutOpen={checkoutOpen}
          />
        ) : (
          <div className="border border-border bg-card">
            <OrdersTable
              orders={data.rows}
              onSelect={setSelected}
              highlightId={highlightId}
              view={view}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <p className={helpTextClass}>
                {t("list.summary", {
                  total: data.total,
                  page: data.page,
                  totalPages,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={data.page <= 1}
                  onClick={() => handlePage(data.page - 1)}
                >
                  {tCommon("previous")}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  disabled={data.page >= totalPages}
                  onClick={() => handlePage(data.page + 1)}
                >
                  {tCommon("next")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <OrderDetailSheet
          order={selected}
          onClose={closeDetail}
          canFulfil={canFulfil}
          onOrderChange={setSelected}
          onNext={nextOrder ? () => setSelected(nextOrder) : undefined}
          queueDone={queueDone}
        />
      )}
    </div>
  );
}
