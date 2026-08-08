"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  OrderFilters,
  OrderSort,
  OrderView,
  Paginated,
} from "@/types/order-view";
import { OrderDetail } from "./OrderDetail";
import { OrdersEmptyState } from "./OrdersEmptyState";
import { OrdersTable } from "./OrdersTable";
import { OrdersToolbar, type SortValue } from "./OrdersToolbar";

// Composition only: filters/sort/page live in the URL (the server page reads
// them and re-queries); this component just wires toolbar -> URL -> table ->
// detail. No data access here.

const SEARCH_DEBOUNCE_MS = 300;

function hasAnyFilter(filters: OrderFilters): boolean {
  return Boolean(
    filters.status ||
      filters.channel ||
      filters.dateFrom ||
      filters.dateTo ||
      (filters.search && filters.search.trim() !== ""),
  );
}

function buildQuery(filters: OrderFilters, sort: OrderSort, page: number): string {
  const params = new URLSearchParams();
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
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function OrdersPage({
  data,
  filters,
  sort,
  deepLinkedOrder = null,
  highlightId = null,
}: {
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

  const navigate = useCallback(
    (next: OrderFilters, nextSort: OrderSort, page: number) => {
      setQueued(false);
      startTransition(() => {
        router.replace(`${pathname}${buildQuery(next, nextSort, page)}`, {
          scroll: false,
        });
      });
    },
    [pathname, router],
  );

  /** Close the panel, and drop `?order=` with it — otherwise a refresh (or the
   *  next filter change, which rebuilds the URL) would reopen it. buildQuery
   *  never emits that param, so re-navigating is the whole fix. Memoised
   *  because the Escape listener below depends on it. */
  const closeDetail = useCallback(() => {
    setSelected(null);
    if (deepLinkedId) navigate(draft, sort, data.page);
  }, [data.page, deepLinkedId, draft, navigate, sort]);

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDetail();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, closeDetail]);

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
      debounceRef.current = setTimeout(() => navigate(next, sort, 1), SEARCH_DEBOUNCE_MS);
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
    navigate(draft, sort, page);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const filtered = hasAnyFilter(draft);

  return (
    <div className="space-y-4">
      <OrdersToolbar
        filters={draft}
        onChange={handleFilters}
        sort={sort}
        onSortChange={handleSort}
      />

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
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-[0.375rem] border border-border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
            <Spinner className="size-3.5 text-muted-foreground" />
            <span className="font-inter text-xs text-muted-foreground">
              Updating…
            </span>
          </div>
        )}

        {data.rows.length === 0 ? (
          <OrdersEmptyState
            filtered={filtered}
            onClear={() => handleFilters({})}
          />
        ) : (
          <div className="border border-border bg-card">
            <OrdersTable
              orders={data.rows}
              onSelect={setSelected}
              highlightId={highlightId}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <p className="font-inter text-sm text-muted-foreground">
                {data.total} order{data.total === 1 ? "" : "s"} · page{" "}
                {data.page} of {totalPages}
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
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Order details">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close order details"
            onClick={closeDetail}
          />
          <div className="relative h-full w-full max-w-md shadow-lg">
            <OrderDetail order={selected} onClose={closeDetail} />
          </div>
        </div>
      )}
    </div>
  );
}
