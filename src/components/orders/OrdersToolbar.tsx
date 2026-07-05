"use client";

import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CircleCheck,
  Clock,
  Code2,
  ListFilter,
  RotateCcw,
  Search,
  Store,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { fieldBaseClass, ghostButtonClass } from "@/components/ui/control-styles";
import { DatePicker } from "@/components/ui/DatePicker";
import { cn } from "@/lib/utils";
import type {
  OrderChannel,
  OrderFilters,
  OrderSort,
  OrderStatus,
} from "@/types/order-view";
import { FilterSelect, type FilterOption } from "./FilterSelect";

export type SortValue = `${OrderSort["field"]}-${OrderSort["direction"]}`;

interface OrdersToolbarProps {
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  sort: OrderSort;
  onSortChange: (value: SortValue) => void;
}

/** Status options with icon + colour tone reused from the status-badge palette
 *  (paid→success, disputed→destructive, refunded→muted). `""` is "no filter". */
const STATUS_OPTIONS: FilterOption<OrderStatus | "">[] = [
  { value: "", label: "All statuses", icon: ListFilter },
  { value: "paid", label: "Paid", icon: CircleCheck, tone: "text-success" },
  { value: "pending", label: "Pending", icon: Clock, tone: "text-foreground" },
  { value: "disputed", label: "Disputed", icon: TriangleAlert, tone: "text-destructive" },
  { value: "refunded", label: "Refunded", icon: RotateCcw, tone: "text-muted-foreground" },
];

const SORT_OPTIONS: FilterOption<SortValue>[] = [
  { value: "createdAt-desc", label: "Newest first", icon: ArrowDownWideNarrow },
  { value: "createdAt-asc", label: "Oldest first", icon: ArrowUpWideNarrow },
  { value: "amount-desc", label: "Amount: high to low", icon: TrendingDown, tone: "text-success" },
  { value: "amount-asc", label: "Amount: low to high", icon: TrendingUp, tone: "text-muted-foreground" },
];

const CHANNEL_META: Record<OrderChannel, { label: string; icon: LucideIcon }> = {
  embed: { label: "Embed", icon: Code2 },
  marketplace: { label: "Marketplace", icon: Store },
};

const CHANNEL_ORDER: OrderChannel[] = ["marketplace", "embed"];

/** Small muted field label — lowercase to match the app voice. */
const fieldLabelClass = "font-inter text-xs font-medium text-muted-foreground";

function hasAnyFilter(filters: OrderFilters): boolean {
  return (
    filters.status !== undefined ||
    filters.channel !== undefined ||
    filters.dateFrom !== undefined ||
    filters.dateTo !== undefined ||
    (filters.search !== undefined && filters.search !== "")
  );
}

export function OrdersToolbar({
  filters,
  onChange,
  sort,
  onSortChange,
}: OrdersToolbarProps) {
  function emit(patch: Partial<OrderFilters>) {
    const next = { ...filters, ...patch };
    // Remove keys that are undefined so callers get a clean object
    (Object.keys(next) as (keyof OrderFilters)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    onChange(next);
  }

  function handleStatus(v: OrderStatus | "") {
    emit({ status: v === "" ? undefined : v });
  }

  function handleChannel(clicked: OrderChannel) {
    emit({ channel: filters.channel === clicked ? undefined : clicked });
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    emit({ search: v === "" ? undefined : v });
  }

  function handleClear() {
    onChange({});
  }

  const anyActive = hasAnyFilter(filters);

  return (
    <div
      role="search"
      aria-label="order filters"
      className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-[0.75rem] border border-border bg-muted/50 p-4"
    >
      {/* Channel segmented toggle */}
      <div className="flex flex-col gap-1.5">
        <span className={fieldLabelClass} id="orders-channel-label">
          channel
        </span>
        <div
          role="group"
          aria-labelledby="orders-channel-label"
          className="flex overflow-hidden rounded-[0.5rem] border border-border bg-background"
        >
          {CHANNEL_ORDER.map((value, i) => {
            const meta = CHANNEL_META[value];
            const Icon = meta.icon;
            const isActive = filters.channel === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleChannel(value)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors duration-180",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  i > 0 && "border-l border-border",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orders-search" className={fieldLabelClass}>
          buyer email
        </label>
        <div className="relative flex items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
          />
          <input
            type="text"
            inputMode="email"
            id="orders-search"
            placeholder="search buyer email"
            value={filters.search ?? ""}
            onChange={handleSearch}
            className={cn(fieldBaseClass, "!py-2 w-56 pl-9")}
          />
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orders-status" className={fieldLabelClass}>
          status
        </label>
        <FilterSelect
          id="orders-status"
          ariaLabel="Filter by status"
          value={filters.status ?? ""}
          options={STATUS_OPTIONS}
          mutedValue=""
          onChange={handleStatus}
          triggerClassName="w-44"
        />
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orders-date" className={fieldLabelClass}>
          date range
        </label>
        <div className="w-64">
          <DatePicker
            id="orders-date"
            mode="range"
            placeholder="any dates"
            triggerClassName="py-2"
            value={{
              from: filters.dateFrom ?? null,
              to: filters.dateTo ?? null,
            }}
            onChange={({ from, to }) =>
              emit({ dateFrom: from ?? undefined, dateTo: to ?? undefined })
            }
          />
        </div>
      </div>

      {/* Sort */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orders-sort" className={fieldLabelClass}>
          sort
        </label>
        <FilterSelect
          id="orders-sort"
          ariaLabel="Sort orders"
          value={`${sort.field}-${sort.direction}` as SortValue}
          options={SORT_OPTIONS}
          onChange={onSortChange}
          triggerClassName="w-52"
          panelClassName="sm:w-60"
        />
      </div>

      {/* Clear filters */}
      {anyActive && (
        <button
          type="button"
          onClick={handleClear}
          className={cn(ghostButtonClass, "ml-auto gap-1.5 px-3 py-2")}
        >
          <X className="size-4 shrink-0" aria-hidden="true" />
          clear filters
        </button>
      )}
    </div>
  );
}
