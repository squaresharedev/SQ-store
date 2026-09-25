import { useTranslations } from "next-intl";
import { badgeClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import type { PayoutStatus } from "@/lib/payments/types";

const STATUS_CLASSES: Record<PayoutStatus, string> = {
  paid: "text-success",
  pending: "text-foreground",
  in_transit: "text-foreground",
  canceled: "text-muted-foreground",
  failed: "text-danger-strong",
};

/** Same pill family as OrderStatusBadge, mapped to Stripe payout statuses. */
export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const t = useTranslations("Payments");
  const known: PayoutStatus = status in STATUS_CLASSES ? status : "pending";
  return (
    <span
      className={cn(
        badgeClass,
        STATUS_CLASSES[known],
      )}
    >
      {t("payoutStatus", { status: known })}
    </span>
  );
}
