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
import {
  ORDERS_SEARCH_MAX_LENGTH,
  type OrderChannel,
  type OrderFilters,
  type OrderSort,
  type OrderStatus,
} from "@/types/order-view";
import { useTranslations } from "next-intl";
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
const STATUS_OPTIONS: Omit<FilterOption<OrderStatus | "">, "label">[] = [
  { value: "", icon: ListFilter },
  { value: "paid", icon: CircleCheck, tone: "text-success" },
  { value: "pending", icon: Clock, tone: "text-foreground" },
  { value: "disputed", icon: TriangleAlert, tone: "text-destructive" },
  { value: "refunded", icon: RotateCcw, tone: "text-muted-foreground" },
];

const SORT_OPTIONS = [
  { value: "createdAt-desc", labelKey: "newest", icon: ArrowDownWideNarrow },
  { value: "createdAt-asc", labelKey: "oldest", icon: ArrowUpWideNarrow },
  { value: "amount-desc", labelKey: "amountHigh", icon: TrendingDown, tone: "text-success" },
  { value: "amount-asc", labelKey: "amountLow", icon: TrendingUp, tone: "text-muted-foreground" },
] as const satisfies readonly (Omit<FilterOption<SortValue>, "label"> & { labelKey: string })[];

const CHANNEL_ICONS: Record<OrderChannel, LucideIcon> = {
  embed: Code2,
  marketplace: Store,
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
  const t = useTranslations("Orders");
  const statusOptions: FilterOption<OrderStatus | "">[] = STATUS_OPTIONS.map((option) => ({
    ...option,
    label: option.value === "" ? t("toolbar.allStatuses") : t(`status.${option.value}`),
  }));
  const sortOptions: FilterOption<SortValue>[] = SORT_OPTIONS.map(({ labelKey, ...option }) => ({
    ...option,
    label: t(`sort.${labelKey}`),
  }));
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
    // Clamped as well as `maxLength`-ed: this value becomes the `?q=` URL
    // param, and the page re-caps it on the way back in, so keeping the two
    // ends agreed avoids a term that survives typing but not a page reload.
    const v = e.target.value.slice(0, ORDERS_SEARCH_MAX_LENGTH);
    emit({ search: v === "" ? undefined : v });
  }

  function handleClear() {
    onChange({});
  }

  const anyActive = hasAnyFilter(filters);

  return (
    <div
      role="search"
      data-tour="orders-filters"
      aria-label={t("toolbar.region")}
      className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-lg border border-border bg-muted/50 p-4"
    >
      {/* Channel segmented toggle */}
      <div className="flex flex-col gap-1.5">
        <span className={fieldLabelClass} id="orders-channel-label">
          {t("toolbar.channel")}
        </span>
        <div
          role="group"
          aria-labelledby="orders-channel-label"
          className="flex overflow-hidden rounded-md border border-border bg-background"
        >
          {CHANNEL_ORDER.map((value, i) => {
            const Icon = CHANNEL_ICONS[value];
            const isActive = filters.channel === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleChannel(value)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors duration-base",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  i > 0 && "border-l border-border",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(`channel.${value}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search. The tour anchor is on the wrapper so the spotlight includes
          the field's label, not just the input. */}
      <div data-tour="orders-search" className="flex flex-col gap-1.5">
        <label htmlFor="orders-search" className={fieldLabelClass}>
          {t("toolbar.buyerEmail")}
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
            // The column this matches is an email address, so the RFC's own
            // maximum is the natural bound — see ORDERS_SEARCH_MAX_LENGTH.
            maxLength={ORDERS_SEARCH_MAX_LENGTH}
            placeholder={t("toolbar.searchPlaceholder")}
            value={filters.search ?? ""}
            onChange={handleSearch}
            className={cn(fieldBaseClass, "!py-2 w-56 pl-9")}
          />
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orders-status" className={fieldLabelClass}>
          {t("toolbar.status")}
        </label>
        <FilterSelect
          id="orders-status"
          ariaLabel={t("toolbar.statusAriaLabel")}
          value={filters.status ?? ""}
          options={statusOptions}
          mutedValue=""
          onChange={handleStatus}
          triggerClassName="w-44"
        />
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="orders-date" className={fieldLabelClass}>
          {t("toolbar.dateRange")}
        </label>
        <div className="w-64">
          <DatePicker
            id="orders-date"
            mode="range"
            placeholder={t("toolbar.datePlaceholder")}
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
          {t("toolbar.sort")}
        </label>
        <FilterSelect
          id="orders-sort"
          ariaLabel={t("toolbar.sortAriaLabel")}
          value={`${sort.field}-${sort.direction}` as SortValue}
          options={sortOptions}
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
          {t("toolbar.clearFilters")}
        </button>
      )}
    </div>
  );
}
