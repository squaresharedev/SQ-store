"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { destructiveButtonClass, ghostButtonClass, helpTextClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import type { OrderView } from "@/types/order-view";

type ConfirmState = "idle" | "confirming" | "done";

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
        <Link href="/settings" className={secondaryButtonClass}>
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

export function OrderActions({ order }: { order: OrderView }) {
  const t = useTranslations("Orders.actions");
  if (order.status === "paid") {
    return <RefundAction />;
  }

  if (order.status === "disputed") {
    return <DisputeAction />;
  }

  // status === "refunded" | "pending"
  return (
    <p className={helpTextClass}>
      {t("none")}
    </p>
  );
}
