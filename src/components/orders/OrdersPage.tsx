"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { secondaryButtonClass } from "@/components/ui/control-styles";
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
}: {
  data: Paginated<OrderView>;
  filters: OrderFilters;
  sort: OrderSort;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // Local echo of the filters so typing in the search box is instant while the
  // URL (and server re-query) catches up debounced.
  const [draft, setDraft] = useState<OrderFilters>(filters);
  const [selected, setSelected] = useState<OrderView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External navigation (back/forward) changes the props; resync the toolbar.
  // State is adjusted during render (not in an effect) per the React docs
  // pattern for derived resets.
  const filtersKey = JSON.stringify(filters);
  const [syncedKey, setSyncedKey] = useState(filtersKey);
  if (syncedKey !== filtersKey) {
    setSyncedKey(filtersKey);
    setDraft(filters);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  function navigate(next: OrderFilters, nextSort: OrderSort, page: number) {
    router.replace(`${pathname}${buildQuery(next, nextSort, page)}`, {
      scroll: false,
    });
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

      {data.rows.length === 0 ? (
        <OrdersEmptyState
          filtered={filtered}
          onClear={() => handleFilters({})}
        />
      ) : (
        <div className="border border-border bg-card">
          <OrdersTable orders={data.rows} onSelect={setSelected} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="font-inter text-sm text-muted-foreground">
              {data.total} order{data.total === 1 ? "" : "s"} · page {data.page}{" "}
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
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Order details">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/40"
            aria-label="Close order details"
            onClick={() => setSelected(null)}
          />
          <div className="relative h-full w-full max-w-md shadow-lg">
            <OrderDetail order={selected} onClose={() => setSelected(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
