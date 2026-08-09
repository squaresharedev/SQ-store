import { badgeClass } from "@/components/ui/surface-styles";
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
  disputed: "text-danger-strong",
  pending: "text-foreground",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const known: OrderStatus = status in STATUS_LABELS ? status : "pending";
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
