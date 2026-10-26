"use client";

import { ArrowUpRight, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { useLeaveForStripe } from "@/components/payments/useLeaveForStripe";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { openStripeDashboard } from "@/lib/payments/connect/actions";
import { buyerMailto } from "@/lib/orders/buyer-mailto";
import { orderNumber } from "@/lib/orders/order-number";
import type { OrderView } from "@/types/order-view";
import { OrderRefund } from "./OrderRefund";
import { useCanRefundOrders } from "./OrderRefundProvider";

/** "Email the buyer", about this order: the subject carries the number they
 *  know it by, so their reply can be matched to it. */
export function EmailBuyerLink({ order, className }: { order: OrderView; className?: string }) {
  const t = useTranslations("Orders.detail");
  if (!order.buyerEmail) return null;
  return (
    <a
      href={buyerMailto(order.buyerEmail, t("mailSubject", { number: orderNumber(order.id) }))}
      className={className ?? secondaryButtonClass}
    >
      <Mail className="size-4" strokeWidth={2} aria-hidden="true" />
      {t("emailBuyer")}
    </a>
  );
}

/**
 * What a seller can DO to an order beyond shipping it.
 *
 * A paid order can be taken back (OrderRefund: cancelled, returned, or
 * otherwise refunded), and a refunded one says when and why. A way to reach
 * the buyer sits beside it, because most of these start with a conversation.
 *
 * A dispute is not ours to answer: it is opened by the buyer's bank and
 * settled with the payment provider, so a disputed order says where that
 * happens and, for the owner, opens it there.
 */
export function OrderActions({
  order,
  onOrderChange,
}: {
  order: OrderView;
  /** The order as it stands after a change, for the panel's owner to keep. */
  onOrderChange?: (order: OrderView) => void;
}) {
  const t = useTranslations("Orders.actions");

  if (order.status === "paid" || order.status === "refunded") {
    return (
      // Buttons share a line and wrap on a narrow panel; the open refund form
      // and the refunded note take a full row of their own.
      <div className="flex flex-wrap items-center gap-3 [&>form]:basis-full [&>p]:basis-full">
        <OrderRefund order={order} onOrderChange={onOrderChange} />
        <EmailBuyerLink order={order} className={`${secondaryButtonClass} w-fit`} />
      </div>
    );
  }
  if (order.status === "disputed") return <DisputeActions />;
  // Still waiting on its payment: nothing to do until that is settled, and
  // the seller is told what happens next instead of "no actions available".
  if (order.status === "pending") {
    return <p className={helpTextClass}>{t("pendingPayment")}</p>;
  }
  return <p className={helpTextClass}>{t("none")}</p>;
}

/** Where a dispute is answered, with the way there for whoever can open the
 *  store's Stripe account (the owner, the same person who can refund). */
function DisputeActions() {
  const t = useTranslations("Orders.actions");
  const canOpenStripe = useCanRefundOrders() && STRIPE_CONNECT_AVAILABLE;
  const [answer, leaving] = useLeaveForStripe(openStripeDashboard);
  return (
    <div className="flex flex-col items-start gap-3">
      <p className={helpTextClass}>{t("disputeInStripe")}</p>
      {canOpenStripe && (
        <Button variant="secondary" onClick={answer} disabled={leaving} aria-busy={leaving || undefined}>
          {leaving && <Spinner />}
          {t("answerInStripe")}
          <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
        </Button>
      )}
    </div>
  );
}
