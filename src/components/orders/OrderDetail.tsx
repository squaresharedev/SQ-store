"use client";

import { X } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import {
  iconButtonClass,
  overlaySurfaceClass,
} from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { CopyButton, type CopyButtonMessages } from "@/components/ui/CopyButton";
import { formatOrderDateTime } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { formatOrderSelection } from "@/lib/orders/selection";
import type { OrderView } from "@/types/order-view";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { OrderActions } from "./OrderActions";

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

const copyMessages = {
  copyVersion: {
    copy: "Orders.detail.copyVersion.copy",
    copied: "Orders.detail.copyVersion.copied",
    failed: "Orders.detail.copyVersion.failed",
  },
  copyBuyerEmail: {
    copy: "Orders.detail.copyBuyerEmail.copy",
    copied: "Orders.detail.copyBuyerEmail.copied",
    failed: "Orders.detail.copyBuyerEmail.failed",
  },
  copyOrderId: {
    copy: "Orders.detail.copyOrderId.copy",
    copied: "Orders.detail.copyOrderId.copied",
    failed: "Orders.detail.copyOrderId.failed",
  },
} satisfies Record<string, CopyButtonMessages>;

export function OrderDetail({
  order,
  onClose,
}: {
  order: OrderView;
  onClose: () => void;
}) {
  const t = useTranslations("Orders");
  const locale = useLocale();
  const youReceiveCents = order.amountCents - order.platformFeeCents;

  return (
    <div className={cn(overlaySurfaceClass, "flex h-full flex-col shadow-none")}>
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
            aria-label={t("detail.close")}
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* WHAT TO PACK, first and copyable. This panel is what a seller has
            open while making the parcel up, so the version the buyer chose
            leads it: the money below is for the books, this is for the box.
            Absent entirely for a product sold in one version. */}
        {order.selection.length > 0 && (
          <Row label={t("detail.version")}>
            <div className="flex items-start gap-1">
              <dl className="min-w-0 flex-1 text-sm text-foreground" data-order-selection="">
                {order.selection.map((entry) => (
                  <div key={entry.label} className="flex flex-wrap gap-x-1.5">
                    <dt className="text-muted-foreground">{entry.label}:</dt>
                    <dd className="min-w-0 break-words font-medium">{entry.value}</dd>
                  </div>
                ))}
              </dl>
              <CopyButton value={formatOrderSelection(order.selection)} messages={copyMessages.copyVersion} />
            </div>
          </Row>
        )}

        <Row label={t("detail.amount")}>
          <span className="text-sm text-foreground">
            {formatCents(order.amountCents, order.currency, locale)}
          </span>
        </Row>

        <Row label={t("detail.platformFee")}>
          <span className="text-sm text-foreground">
            {formatCents(order.platformFeeCents, order.currency, locale)}
          </span>
        </Row>

        <Row label={t("detail.youReceive")}>
          <span className="text-sm text-foreground">
            {formatCents(youReceiveCents, order.currency, locale)}
          </span>
        </Row>

        <Row label={t("detail.buyerEmail")}>
          {order.buyerEmail ? (
            // Copyable: the buyer's email is the thing a seller reaches for
            // when answering a support message about this order.
            <div className="flex items-center gap-1">
              <span className="min-w-0 break-all text-sm text-foreground">
                {order.buyerEmail}
              </span>
              <CopyButton value={order.buyerEmail} messages={copyMessages.copyBuyerEmail} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">{t("detail.noEmail")}</span>
          )}
        </Row>

        <Row label={t("detail.channel")}>
          <span className="text-sm text-foreground">
            {t(`channel.${order.channel}`)}
          </span>
        </Row>

        <Row label={t("detail.date")}>
          <span className="text-sm text-foreground">
            {formatOrderDateTime(order.createdAt, locale)}
          </span>
        </Row>

        <Row label={t("detail.orderId")}>
          <div className="flex items-center gap-1">
            <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
              {order.id}
            </span>
            <CopyButton value={order.id} messages={copyMessages.copyOrderId} />
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
