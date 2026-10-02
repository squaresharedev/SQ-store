"use client";

import { TriangleAlert, X } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import {
  helpTextClass,
  iconButtonClass,
  overlaySurfaceClass,
} from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { CopyButton, type CopyButtonMessages } from "@/components/ui/CopyButton";
import { formatOrderDateTime } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import { regionName } from "@/lib/format/country";
import { orderNumber } from "@/lib/orders/order-number";
import { formatOrderSelection } from "@/lib/orders/selection";
import { formatShipTo } from "@/lib/orders/ship-to";
import type { OrderView } from "@/types/order-view";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { EmailBuyerLink, OrderActions } from "./OrderActions";
import { OrderShipping } from "./OrderShipping";

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
  copyPack: {
    copy: "Orders.detail.copyPack.copy",
    copied: "Orders.detail.copyPack.copied",
    failed: "Orders.detail.copyPack.failed",
  },
  copyAddress: {
    copy: "Orders.detail.copyAddress.copy",
    copied: "Orders.detail.copyAddress.copied",
    failed: "Orders.detail.copyAddress.failed",
  },
  copyPhone: {
    copy: "Orders.detail.copyPhone.copy",
    copied: "Orders.detail.copyPhone.copied",
    failed: "Orders.detail.copyPhone.failed",
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
  copyOrderNumber: {
    copy: "Orders.detail.copyOrderNumber.copy",
    copied: "Orders.detail.copyOrderNumber.copied",
    failed: "Orders.detail.copyOrderNumber.failed",
  },
} satisfies Record<string, CopyButtonMessages>;

/** The version the buyer chose, as label/value pairs. */
function SelectionList({ order }: { order: OrderView }) {
  return (
    <dl className="text-sm text-foreground" data-order-selection="">
      {order.selection.map((entry) => (
        <div key={entry.label} className="flex flex-wrap gap-x-1.5">
          <dt className="text-muted-foreground">{entry.label}:</dt>
          <dd className="min-w-0 break-words font-medium">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OrderDetail({
  order,
  onClose,
  canFulfil = false,
  onOrderChange,
  onNext,
  queueDone = false,
}: {
  order: OrderView;
  onClose: () => void;
  /** Whether this member may mark orders shipped (orders.fulfil). */
  canFulfil?: boolean;
  /** Called with the order as it stands after a shipping change. */
  onOrderChange?: (order: OrderView) => void;
  /** Opens the next order waiting to ship, when this panel was opened from the
   *  To ship queue and there is one (see OrderShipping). */
  onNext?: () => void;
  /** This panel was opened from the To ship queue and nothing else is in it. */
  queueDone?: boolean;
}) {
  const t = useTranslations("Orders");
  const locale = useLocale();
  const youReceiveCents = order.amountCents - order.platformFeeCents;
  const ships = order.fulfilment.status !== "not_required";
  const packLine = t("detail.packLine", { quantity: order.quantity, title: order.productTitle });
  const packText = [
    packLine,
    ...(order.selection.length > 0 ? [formatOrderSelection(order.selection)] : []),
  ].join("\n");
  const address = order.shipTo
    ? formatShipTo(order.shipTo, regionName(order.shipTo.country, locale))
    : null;

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

      {/* Body. THE PARCEL FIRST, top to bottom in the order it is made up: what
          goes in the box, where it goes, then the button that says it has
          gone. This panel is what a seller has open while packing, so the
          money (for the books) and the ids (for support) come after. */}
      <div className="flex flex-col gap-4 overflow-y-auto p-4">
        {/* THE NUMBER THE BUYER QUOTES. Their confirmation and order page call
            this "Order 44561113"; without it here a seller reading "where is my
            order 44561113?" has to match it to a UUID by eye. Search finds an
            order by it too. */}
        <div className="flex items-center gap-1 font-inter text-xs text-muted-foreground">
          <span data-order-number="">{t("detail.orderNumberLine", { number: orderNumber(order.id) })}</span>
          <CopyButton value={orderNumber(order.id)} messages={copyMessages.copyOrderNumber} />
        </div>

        {ships ? (
          <Row label={t("detail.pack")}>
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-foreground" data-order-pack="">
                  {packLine}
                </p>
                {order.selection.length > 0 && <SelectionList order={order} />}
              </div>
              <CopyButton value={packText} messages={copyMessages.copyPack} />
            </div>
          </Row>
        ) : (
          // Nothing to pack for a download, but the version still says which
          // file the buyer paid for. Absent for a product sold in one version.
          order.selection.length > 0 && (
            <Row label={t("detail.version")}>
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <SelectionList order={order} />
                </div>
                <CopyButton
                  value={formatOrderSelection(order.selection)}
                  messages={copyMessages.copyVersion}
                />
              </div>
            </Row>
          )
        )}

        {ships && order.giftMessage && (
          <Row label={t("detail.giftMessage")}>
            {/* Quoted and whitespace-pre-line: the buyer's own words, untouched. */}
            <p className="whitespace-pre-line text-sm text-foreground">
              {order.giftMessage}
            </p>
          </Row>
        )}

        {order.withdrawalRequestedAt && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-4 py-3"
          >
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-foreground"
              strokeWidth={2}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <p className="text-sm text-foreground">
                {t("detail.withdrawalNotice", {
                  date: formatOrderDateTime(order.withdrawalRequestedAt, locale),
                })}
              </p>
              {/* "Arrange the return and refund with them" needs a way to reach
                  them; the address is otherwise only a copy button further down. */}
              <EmailBuyerLink order={order} />
            </div>
          </div>
        )}

        {ships && (
          <Row label={t("detail.shipTo")}>
            {address ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-start gap-1">
                  {/* One copy button for the whole label, laid out as the
                      destination's post expects: paste it straight into a
                      carrier's form or onto a label. */}
                  <address
                    className="min-w-0 flex-1 whitespace-pre-line break-words text-sm not-italic text-foreground"
                    data-order-ship-to=""
                  >
                    {address}
                  </address>
                  <CopyButton value={address} messages={copyMessages.copyAddress} />
                </div>
                {order.shipTo?.phone && (
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 break-all text-sm text-foreground">
                      {order.shipTo.phone}
                    </span>
                    <CopyButton value={order.shipTo.phone} messages={copyMessages.copyPhone} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <p className={helpTextClass}>{t("detail.noAddress")}</p>
                <EmailBuyerLink order={order} />
              </div>
            )}
          </Row>
        )}

        <Row label={t("detail.shipping")}>
          <OrderShipping
            order={order}
            canFulfil={canFulfil}
            onOrderChange={onOrderChange}
            onNext={onNext}
            queueDone={queueDone}
            withdrawn={order.withdrawalRequestedAt !== null}
          />
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

        <Row label={t("detail.amount")}>
          <span className="text-sm text-foreground">
            {formatCents(order.amountCents, order.currency, locale)}
          </span>
        </Row>

        <Row
          label={
            // The rate the sale was charged at, when the order recorded it
            // (every order since plans; older ones show the bare label).
            order.platformFeeBps !== null
              ? t("detail.platformFeeRate", { rate: formatFeeRate(order.platformFeeBps, locale) })
              : t("detail.platformFee")
          }
        >
          <span className="text-sm text-foreground">
            {formatCents(order.platformFeeCents, order.currency, locale)}
          </span>
        </Row>

        <Row label={t("detail.youReceive")}>
          <span className="text-sm text-foreground">
            {formatCents(youReceiveCents, order.currency, locale)}
          </span>
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

      {/* Footer: what can be done to the order beyond shipping it. Not for a
          member who cannot fulfil: a viewer was offered a red Refund button
          they could press and be refused by, and read-only means no controls. */}
      {canFulfil && (
        <div className="mt-auto border-t border-border px-4 py-3">
          <OrderActions order={order} />
        </div>
      )}
    </div>
  );
}
