"use client";

import type { OrderView } from "@/types/order-view";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";

export function OrderRow({
  order,
  onSelect,
}: {
  order: OrderView;
  onSelect: (order: OrderView) => void;
}) {
  const channelLabel =
    order.channel === "marketplace" ? "Marketplace" : "Embed";

  return (
    <tr
      onClick={() => onSelect(order)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSelect(order);
        } else if (e.key === " ") {
          e.preventDefault();
          onSelect(order);
        }
      }}
      tabIndex={0}
      className="cursor-pointer transition-colors duration-180 motion-reduce:transition-none hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {/* product */}
      <td className="py-2.5 px-3 max-w-xs truncate text-sm font-medium text-foreground">
        {order.productTitle}
      </td>

      {/* amount */}
      <td className="py-2.5 px-3 font-inter text-sm text-foreground whitespace-nowrap">
        {formatCents(order.amountCents, order.currency)}
      </td>

      {/* channel — hidden below md */}
      <td className="hidden md:table-cell py-2.5 px-3 font-inter text-sm text-muted-foreground">
        {channelLabel}
      </td>

      {/* status */}
      <td className="py-2.5 px-3">
        <OrderStatusBadge status={order.status} />
      </td>

      {/* buyer — hidden below md */}
      <td className="hidden md:table-cell py-2.5 px-3 font-inter text-sm text-muted-foreground max-w-xs truncate">
        {order.buyerEmail ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* date */}
      <td className="py-2.5 px-3 font-inter text-sm text-muted-foreground whitespace-nowrap">
        {formatOrderDate(order.createdAt)}
      </td>
    </tr>
  );
}
