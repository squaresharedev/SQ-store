"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  ghostButtonClass,
  helpTextClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";

/**
 * What the orders list says when it has no rows.
 *
 * An empty To ship queue says the seller is caught up, and offers the full
 * list. A filter that matched nothing offers to clear it. An empty list otherwise
 * says why, honestly: checkout on Square Share is not open yet, so a sale made
 * through a product's own buy link or by email happens somewhere this page
 * cannot see. Promising "your first sale shows up here" to a seller whose sales
 * cannot arrive is how a page teaches someone to stop trusting it. It points at
 * the step that does exist instead.
 */
export function OrdersEmptyState({
  filtered,
  onClear,
  toShip = false,
  onSeeAll,
}: {
  filtered: boolean;
  onClear?: () => void;
  /** The To ship queue is empty: a finished job, not a missing feature. */
  toShip?: boolean;
  /** Switch to the full list (shown with `toShip`). */
  onSeeAll?: () => void;
}) {
  const t = useTranslations("Orders.empty");
  return (
    <div className="border border-border bg-card px-4 py-16 text-center">
      {toShip ? (
        <>
          <p className="text-base font-semibold text-foreground">{t("toShipTitle")}</p>
          <p className={cn(helpTextClass, "mx-auto mt-1 max-w-md")}>{t("toShipHint")}</p>
          {onSeeAll && (
            <button
              type="button"
              className={cn(secondaryButtonClass, "mt-4")}
              onClick={onSeeAll}
            >
              {t("seeAllOrders")}
            </button>
          )}
        </>
      ) : filtered ? (
        <>
          <p className="text-base font-semibold text-foreground">
            {t("filteredTitle")}
          </p>
          <p className={cn(helpTextClass, "mt-1")}>{t("filteredHint")}</p>
          {onClear && (
            <button
              type="button"
              className={cn(ghostButtonClass, "mt-4")}
              onClick={onClear}
            >
              {t("clearFilters")}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-base font-semibold text-foreground">{t("title")}</p>
          <p className={cn(helpTextClass, "mx-auto mt-1 max-w-md")}>{t("hint")}</p>
          <Link href="/products" className={cn(secondaryButtonClass, "mt-4")}>
            {t("goToProducts")}
          </Link>
        </>
      )}
    </div>
  );
}
