import { useTranslations } from "next-intl";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import type { OrderStatus } from "@/types/order-view";

const STATUS_CLASSES: Record<OrderStatus, string> = {
  paid: "text-success",
  refunded: "text-muted-foreground",
  disputed: "text-danger-strong",
  pending: "text-foreground",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("Orders.status");
  const known: OrderStatus = status in STATUS_CLASSES ? status : "pending";
  return (
    <span
      className={cn(
        badgeClass,
        STATUS_CLASSES[known],
      )}
    >
      {t(known)}
    </span>
  );
}
