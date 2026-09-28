"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { OrderView, OrdersView } from "@/types/order-view";
import { OrderRow } from "./OrderRow";

/** One column heading. Cells hidden below md say so at the call site. */
const headerCellClass =
  "py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground";

/**
 * The orders list. Its columns follow the view: "To ship" is a work queue, so
 * it shows what the seller needs to act on (where each parcel goes) and drops
 * what every row there shares (paid, not shipped); "All orders" is the ledger,
 * with the money and both statuses.
 */
export function OrdersTable({
  orders,
  onSelect,
  highlightId = null,
  view = "all",
}: {
  orders: OrderView[];
  onSelect: (order: OrderView) => void;
  /** Row to mark as the one the user arrived for (see OrdersPage). */
  highlightId?: string | null;
  view?: OrdersView;
}) {
  const t = useTranslations("Orders.table");
  const toShip = view === "to-ship";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={headerCellClass}>{t("product")}</th>
            {toShip ? (
              <th className={headerCellClass}>{t("shipTo")}</th>
            ) : (
              <>
                <th className={cn(headerCellClass, "whitespace-nowrap")}>{t("amount")}</th>
                <th className={cn(headerCellClass, "hidden md:table-cell")}>{t("channel")}</th>
                <th className={headerCellClass}>{t("status")}</th>
                <th className={headerCellClass}>{t("shipping")}</th>
              </>
            )}
            <th className={cn(headerCellClass, "hidden md:table-cell")}>{t("buyer")}</th>
            <th className={cn(headerCellClass, "whitespace-nowrap")}>{t("date")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              onSelect={onSelect}
              highlighted={order.id === highlightId}
              view={view}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
