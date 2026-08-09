import Link from "next/link";
import { infoTextClass } from "@/components/ui/control-styles";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import type { DashboardOrder, OrderStatus } from "@/lib/dashboard/queries";
import { formatCents, formatOrderDate } from "@/lib/dashboard/format";
import { ModuleCard, ModuleEmptyText } from "./ModuleCard";

const STATUS_LABELS: Record<OrderStatus, string> = {
  paid: "Paid",
  refunded: "Refunded",
  disputed: "Disputed",
  pending: "Pending",
};

const STATUS_CLASSES: Record<OrderStatus, string> = {
  paid: "text-success",
  refunded: "text-danger-strong",
  disputed: "text-danger-strong",
  pending: "text-muted-foreground",
};

const CHANNEL_LABELS: Record<DashboardOrder["channel"], string> = {
  embed: "Embed",
  marketplace: "Marketplace",
};

function StatusBadge({ status }: { status: OrderStatus }) {
  const known: OrderStatus = STATUS_LABELS[status] ? status : "pending";
  return (
    <span
      className={cn(
        badgeClass,
        STATUS_CLASSES[known],
      )}
    >
      {STATUS_LABELS[known]}
    </span>
  );
}

/** The latest ~5 orders across all statuses. */
export function RecentOrders({
  orders,
  id,
}: {
  orders: DashboardOrder[];
  id?: string;
}) {
  return (
    <ModuleCard title="Recent orders" id={id}>
      {orders.length === 0 ? (
        <ModuleEmptyText>
          No orders yet. They will show up here as soon as you make your first
          sale.
        </ModuleEmptyText>
      ) : (
        <ul className="divide-y divide-border">
          {orders.map((order, index) => (
            <li
              key={order.id ?? `${order.created_at}-${index}`}
              className="first:[&>a]:pt-0 last:[&>a]:pb-0"
            >
              {/* The whole row is the target: /orders?order=<id> opens that
                  order's detail panel. An id-less row (an older cached RPC
                  payload) still lands on the list rather than a dead link. */}
              <Link
                href={order.id ? `/orders?order=${order.id}` : "/orders"}
                className="-mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sm px-2 py-2.5 transition-colors duration-base ease-standard hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {order.product_title}
                  </p>
                  <p className={infoTextClass}>
                    {CHANNEL_LABELS[order.channel] ?? "Embed"} ·{" "}
                    {formatOrderDate(order.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={order.status} />
                  <span className="font-inter text-sm font-medium text-foreground">
                    {formatCents(order.amount_cents, order.currency)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}
