"use client";

import { Search } from "lucide-react";
import {
  fieldBaseClass,
  ghostButtonClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { DatePicker } from "@/components/ui/DatePicker";
import { cn } from "@/lib/utils";
import type { OrderChannel, OrderFilters, OrderStatus } from "@/types/order-view";

interface OrdersToolbarProps {
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
}

const STATUS_OPTIONS: { value: OrderStatus | ""; label: string }[] = [
  { value: "", label: "all statuses" },
  { value: "paid", label: "paid" },
  { value: "refunded", label: "refunded" },
  { value: "disputed", label: "disputed" },
  { value: "pending", label: "pending" },
];

const CHANNEL_OPTIONS: { value: OrderChannel; label: string }[] = [
  { value: "embed", label: "embed" },
  { value: "marketplace", label: "marketplace" },
];

function hasAnyFilter(filters: OrderFilters): boolean {
  return (
    filters.status !== undefined ||
    filters.channel !== undefined ||
    filters.dateFrom !== undefined ||
    filters.dateTo !== undefined ||
    (filters.search !== undefined && filters.search !== "")
  );
}

export function OrdersToolbar({ filters, onChange }: OrdersToolbarProps) {
  function emit(patch: Partial<OrderFilters>) {
    const next = { ...filters, ...patch };
    // Remove keys that are undefined so callers get a clean object
    (Object.keys(next) as (keyof OrderFilters)[]).forEach((k) => {
      if (next[k] === undefined) delete next[k];
    });
    onChange(next);
  }

  function handleStatus(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value as OrderStatus | "";
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
      className="flex flex-wrap items-end gap-3"
    >
      {/* Status */}
      <div className="flex flex-col gap-1">
        <label htmlFor="orders-status" className={cn(labelClass, "text-xs")}>
          status
        </label>
        <select
          id="orders-status"
          value={filters.status ?? ""}
          onChange={handleStatus}
          className={cn(fieldBaseClass, "w-40")}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Channel segmented toggle */}
      <div className="flex flex-col gap-1">
        <span className={cn(labelClass, "text-xs")} id="orders-channel-label">
          channel
        </span>
        <div
          role="group"
          aria-labelledby="orders-channel-label"
          className="flex"
        >
          {CHANNEL_OPTIONS.map((opt) => {
            const isActive = filters.channel === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleChannel(opt.value)}
                className={cn(
                  secondaryButtonClass,
                  isActive && "bg-accent text-foreground",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-1">
        <label htmlFor="orders-date" className={cn(labelClass, "text-xs")}>
          date range
        </label>
        <div className="w-64">
          <DatePicker
            id="orders-date"
            mode="range"
            placeholder="any dates"
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

      {/* Search */}
      <div className="flex flex-col gap-1">
        <label htmlFor="orders-search" className={cn(labelClass, "text-xs")}>
          buyer email
        </label>
        <div className="relative flex items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
          />
          <input
            type="search"
            id="orders-search"
            placeholder="search buyer email"
            value={filters.search ?? ""}
            onChange={handleSearch}
            className={cn(fieldBaseClass, "pl-9 w-56")}
          />
        </div>
      </div>

      {/* Clear filters */}
      {anyActive && (
        <button
          type="button"
          onClick={handleClear}
          className={ghostButtonClass}
        >
          clear filters
        </button>
      )}
    </div>
  );
}
