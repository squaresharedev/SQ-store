"use client";

import { ghostButtonClass } from "@/components/ui/control-styles";

export function OrdersEmptyState({
  filtered,
  onClear,
}: {
  filtered: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="border border-border bg-card py-16 text-center">
      {filtered ? (
        <>
          <p className="text-base font-semibold text-foreground">
            no orders match these filters
          </p>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            try widening the date range or clearing filters.
          </p>
          {onClear && (
            <button
              type="button"
              className={ghostButtonClass + " mt-4"}
              onClick={onClear}
            >
              clear filters
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-foreground">
            no orders yet
          </p>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            orders show up here as soon as you make your first sale.
          </p>
        </>
      )}
    </div>
  );
}
