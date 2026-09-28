import { useTranslations } from "next-intl";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import type { FulfilmentStatus } from "@/types/order-view";

/**
 * Whether the parcel has gone, beside OrderStatusBadge (whether it is paid).
 * The one state that asks for work is an ink chip, the only filled chip in the
 * list, so a seller scanning "All orders" sees what still needs sending; the
 * settled states step back into the ordinary chip.
 */
const FULFILMENT_CLASSES: Record<FulfilmentStatus, string> = {
  unfulfilled: "bg-foreground text-background",
  shipped: "text-success",
  not_required: "text-muted-foreground",
};

export function FulfilmentBadge({ status }: { status: FulfilmentStatus }) {
  const t = useTranslations("Orders.fulfilment");
  return (
    <span className={cn(badgeClass, FULFILMENT_CLASSES[status])} data-fulfilment={status}>
      {t(status)}
    </span>
  );
}
