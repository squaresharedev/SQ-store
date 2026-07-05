import { cn } from "@/lib/utils";
import type { PayoutStatus } from "@/lib/payments/types";

const STATUS_LABELS: Record<PayoutStatus, string> = {
  paid: "Paid",
  pending: "Pending",
  in_transit: "In transit",
  canceled: "Canceled",
  failed: "Failed",
};

const STATUS_CLASSES: Record<PayoutStatus, string> = {
  paid: "text-success",
  pending: "text-foreground",
  in_transit: "text-foreground",
  canceled: "text-muted-foreground",
  failed: "text-destructive",
};

/** Same pill family as OrderStatusBadge, mapped to Stripe payout statuses. */
export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const known: PayoutStatus = status in STATUS_LABELS ? status : "pending";
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
