"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { destructiveButtonClass, ghostButtonClass, helpTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { PAYMENTS_PATH } from "@/lib/dashboard/paths";
import { buyerMailto } from "@/lib/orders/buyer-mailto";
import { orderNumber } from "@/lib/orders/order-number";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import type { OrderView } from "@/types/order-view";

type ConfirmState = "idle" | "confirming" | "done";

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

function RefundAction() {
  const t = useTranslations("Orders.actions");
  const tCommon = useTranslations("Common.actions");
  const [state, setState] = useState<ConfirmState>("idle");

  if (state === "done") {
    return (
      <div className="flex flex-col gap-2">
        <p className={helpTextClass}>
          {t("refundNeedsStripe")}
        </p>
        <Link href={PAYMENTS_PATH} className={secondaryButtonClass}>
          {t("connectStripe")}
        </Link>
      </div>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-inter text-sm text-foreground">
          {t("refundConfirm")}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              // TODO(stripe): trigger refund mutation via Stripe slice
              setState("done");
            }}
          >
            {t("confirmRefund")}
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => setState("idle")}
          >
            {tCommon("cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={destructiveButtonClass}
      onClick={() => setState("confirming")}
    >
      {t("refundOrder")}
    </button>
  );
}

function DisputeAction() {
  const t = useTranslations("Orders.actions");
  const tCommon = useTranslations("Common.actions");
  const [state, setState] = useState<ConfirmState>("idle");

  if (state === "done") {
    return (
      <p className={helpTextClass}>
        {t("disputeInStripe")}
      </p>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-inter text-sm text-foreground">
          {t("disputeConfirm")}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => {
              // TODO(stripe): open dispute in Stripe slice / redirect to Stripe dashboard
              setState("done");
            }}
          >
            {tCommon("confirm")}
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => setState("idle")}
          >
            {tCommon("cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={secondaryButtonClass}
      onClick={() => setState("confirming")}
    >
      {t("handleDispute")}
    </button>
  );
}

/**
 * What a seller can DO to an order beyond shipping it: refund it, or answer a
 * dispute. Both belong to the payment provider, and until one is connected
 * (STRIPE_CONNECT_AVAILABLE) neither can be done from here.
 *
 * So until then this does not offer them. A red "Refund order" that asks to be
 * confirmed and then answers "Refunds require Stripe to be connected", with a
 * link to a page that has no Stripe on it, is a button that teaches a seller
 * the product is broken. It says what is true instead: how to refund today,
 * and a way to reach the buyer. The stub flows stay below for the day Stripe
 * lands, and reach the connect page (/payments) where they used to reach
 * Settings.
 */
export function OrderActions({ order }: { order: OrderView }) {
  const t = useTranslations("Orders.actions");
  if (order.status === "paid") {
    if (!STRIPE_CONNECT_AVAILABLE) {
      return (
        <div className="flex flex-col gap-2">
          <p className={helpTextClass}>{t("refundManual")}</p>
          <EmailBuyerLink order={order} className={`${secondaryButtonClass} w-fit`} />
        </div>
      );
    }
    return <RefundAction />;
  }

  if (order.status === "disputed") {
    if (!STRIPE_CONNECT_AVAILABLE) {
      return <p className={helpTextClass}>{t("disputeInStripe")}</p>;
    }
    return <DisputeAction />;
  }

  // status === "refunded" | "pending"
  return (
    <p className={helpTextClass}>
      {t("none")}
    </p>
  );
}
