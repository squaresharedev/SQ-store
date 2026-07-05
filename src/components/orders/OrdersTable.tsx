"use client";

import type { OrderView } from "@/types/order-view";
import { OrderRow } from "./OrderRow";

export function OrdersTable({
  orders,
  onSelect,
}: {
  orders: OrderView[];
  onSelect: (order: OrderView) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground">
              Product
            </th>
            <th className="py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Amount
            </th>
            <th className="hidden md:table-cell py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground">
              Channel
            </th>
            <th className="py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground">
              Status
            </th>
            <th className="hidden md:table-cell py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground">
              Buyer
            </th>
            <th className="py-2 px-3 text-left font-inter text-xs uppercase tracking-wide text-muted-foreground whitespace-nowrap">
              Date
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.map((order) => (
            <OrderRow key={order.id} order={order} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
