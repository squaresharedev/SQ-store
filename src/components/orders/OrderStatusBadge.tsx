import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types/order-view";

const STATUS_LABELS: Record<OrderStatus, string> = {
  paid: "Paid",
  refunded: "Refunded",
  disputed: "Disputed",
  pending: "Pending",
};

const STATUS_CLASSES: Record<OrderStatus, string> = {
  paid: "text-success",
  refunded: "text-muted-foreground",
  disputed: "text-destructive",
  pending: "text-foreground",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const known: OrderStatus = status in STATUS_LABELS ? status : "pending";
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
