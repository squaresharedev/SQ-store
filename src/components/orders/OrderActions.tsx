"use client";

import { useState } from "react";
import Link from "next/link";
import {
  destructiveButtonClass,
  ghostButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import type { OrderView } from "@/types/order-view";

type ConfirmState = "idle" | "confirming" | "done";

function RefundAction() {
  const [state, setState] = useState<ConfirmState>("idle");

  if (state === "done") {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-inter text-sm text-muted-foreground">
          Refunds require Stripe to be connected.
        </p>
        <Link href="/settings" className={secondaryButtonClass}>
          Connect Stripe to enable refunds
        </Link>
      </div>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-inter text-sm text-foreground">
          Refund this order? This cannot be undone once Stripe is connected.
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
            Confirm refund
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => setState("idle")}
          >
            Cancel
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
      Refund order
    </button>
  );
}

function DisputeAction() {
  const [state, setState] = useState<ConfirmState>("idle");

  if (state === "done") {
    return (
      <p className="font-inter text-sm text-muted-foreground">
        Disputes are handled in your Stripe dashboard once Stripe is connected.
      </p>
    );
  }

  if (state === "confirming") {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-inter text-sm text-foreground">
          Open dispute handling for this order?
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
            Confirm
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => setState("idle")}
          >
            Cancel
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
      Handle dispute
    </button>
  );
}

export function OrderActions({ order }: { order: OrderView }) {
  if (order.status === "paid") {
    return <RefundAction />;
  }

  if (order.status === "disputed") {
    return <DisputeAction />;
  }

  // status === "refunded" | "pending"
  return (
    <p className="font-inter text-sm text-muted-foreground">
      No actions are available for this order.
    </p>
  );
}
