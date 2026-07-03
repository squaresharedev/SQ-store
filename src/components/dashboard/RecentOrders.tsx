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
  refunded: "text-destructive",
  disputed: "text-destructive",
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
        "rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium",
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
              key={`${order.created_at}-${index}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {order.product_title}
                </p>
                <p className="font-inter text-xs text-muted-foreground">
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
            </li>
          ))}
        </ul>
      )}
    </ModuleCard>
  );
}
