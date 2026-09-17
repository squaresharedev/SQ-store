"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  ghostButtonClass,
  helpTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";

/**
 * What the orders list says when it has no rows.
 *
 * A filter that matched nothing offers to clear it. An empty list otherwise
 * says why, honestly: checkout on Square Share is not open yet, so a sale made
 * through a product's own buy link or by email happens somewhere this page
 * cannot see. Promising "your first sale shows up here" to a seller whose sales
 * cannot arrive is how a page teaches someone to stop trusting it. It points at
 * the step that does exist instead.
 */
export function OrdersEmptyState({
  filtered,
  onClear,
}: {
  filtered: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="border border-border bg-card px-4 py-16 text-center">
      {filtered ? (
        <>
          <p className="text-base font-semibold text-foreground">
            No orders match these filters
          </p>
          <p className={cn(helpTextClass, "mt-1")}>
            Try widening the date range or clearing filters.
          </p>
          {onClear && (
            <button
              type="button"
              className={cn(ghostButtonClass, "mt-4")}
              onClick={onClear}
            >
              Clear filters
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-foreground">No orders yet</p>
          <p className={cn(helpTextClass, "mx-auto mt-1 max-w-md")}>
            Square Share checkout isn&apos;t open yet. Sales through your own buy
            link or by email won&apos;t show up here.
          </p>
          <Link href="/products" className={cn(secondaryButtonClass, "mt-4")}>
            Go to products
          </Link>
        </>
      )}
    </div>
  );
}
