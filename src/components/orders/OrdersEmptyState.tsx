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
  const t = useTranslations("Orders.empty");
  return (
    <div className="border border-border bg-card px-4 py-16 text-center">
      {filtered ? (
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
