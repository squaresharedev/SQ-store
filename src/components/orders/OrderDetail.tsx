"use client";

import { X } from "lucide-react";
import { iconButtonClass } from "@/components/ui/control-styles";
import { CopyButton } from "@/components/ui/CopyButton";
import { formatOrderDateTime } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import type { OrderView } from "@/types/order-view";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { OrderActions } from "./OrderActions";

const CHANNEL_LABELS: Record<OrderView["channel"], string> = {
  embed: "Embed",
  marketplace: "Marketplace",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-inter text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

export function OrderDetail({
  order,
  onClose,
}: {
  order: OrderView;
  onClose: () => void;
}) {
  const youReceiveCents = order.amountCents - order.platformFeeCents;

  return (
    <div className="flex flex-col bg-card border border-border h-full">
      {/* Header. h-14 is the app's bar height (TopBar, the mobile header, the
          sidebar brand row all use it), so the panel's top edge lines up with
          the page's own bar instead of sitting a few pixels off it. */}
      <div
        data-testid="order-detail-header"
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold text-foreground">
            {order.productTitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass}
            aria-label="Close order details"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        <Row label="Amount">
          <span className="text-sm text-foreground">
            {formatCents(order.amountCents, order.currency)}
          </span>
        </Row>

        <Row label="Platform fee">
          <span className="text-sm text-foreground">
            {formatCents(order.platformFeeCents, order.currency)}
          </span>
        </Row>

        <Row label="You receive">
          <span className="text-sm text-foreground">
            {formatCents(youReceiveCents, order.currency)}
          </span>
        </Row>

        <Row label="Buyer email">
          {order.buyerEmail ? (
            // Copyable: the buyer's email is the thing a seller reaches for
            // when answering a support message about this order.
            <div className="flex items-center gap-1">
              <span className="min-w-0 break-all text-sm text-foreground">
                {order.buyerEmail}
              </span>
              <CopyButton value={order.buyerEmail} label="buyer email" />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">no email</span>
          )}
        </Row>

        <Row label="Channel">
          <span className="text-sm text-foreground">
            {CHANNEL_LABELS[order.channel]}
          </span>
        </Row>

        <Row label="Date">
          <span className="text-sm text-foreground">
            {formatOrderDateTime(order.createdAt)}
          </span>
        </Row>

        <Row label="Order ID">
          <div className="flex items-center gap-1">
            <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
              {order.id}
            </span>
            <CopyButton value={order.id} label="order ID" />
          </div>
        </Row>
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-border px-4 py-3">
        <OrderActions order={order} />
      </div>
    </div>
  );
}
