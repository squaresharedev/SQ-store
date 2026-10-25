"use client";

import {
  CalendarDays,
  Gift,
  Hash,
  Layers,
  Mail,
  MapPin,
  Package,
  Phone,
  TriangleAlert,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import {
  helpTextClass,
  iconButtonClass,
  overlaySurfaceClass,
} from "@/components/ui/control-styles";
import { iconTileClass } from "@/components/ui/surface-styles";
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
import { CHANNEL_ICONS } from "./channel-icons";
import { EmailBuyerLink, OrderActions } from "./OrderActions";
import { OrderShipping } from "./OrderShipping";

/**
 * One fact in the panel: a small icon tile, then the value, then (optionally)
 * its copy button. The icon is what a seller scans for; `label` is the same
 * thing in words for screen readers, so nothing is lost by not printing it.
 */
function DetailRow({
  icon: Icon,
  label,
  trailing,
  children,
}: {
  icon: LucideIcon;
  /** Read aloud, never shown: the icon says it. Omit when the content names itself. */
  label?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className={cn(iconTileClass, "size-8 text-muted-foreground")}>
        <Icon className="size-4" strokeWidth={2} />
      </span>
      {/* pt-1.5: a 20px text line centred on the 32px tile. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
        {label && <span className="sr-only">{label}</span>}
        {children}
      </div>
      {trailing}
    </div>
  );
}

/** One line of the money ledger: the label on the left, the figure on the right. */
function LedgerLine({
  label,
  strong = false,
  hint,
  children,
}: {
  label: string;
  /** The line that matters: what the seller is left with. */
  strong?: boolean;
  /** A quiet note under the amount, about what the figure leaves out. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        strong ? "border-t border-border pt-1.5 font-semibold text-foreground" : "text-foreground",
      )}
    >
      <dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
      <dd className="text-right tabular-nums">
        {children}
        {hint && <span className="block font-inter text-xs font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}

/** A small icon and a value on the quiet meta line (channel, date). */
function MetaItem({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      {children}
    </li>
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
  // A refund sends the whole payment back, our fee included, so a refunded
  // order's last line is what went back, not money the seller still has.
  const refunded = order.status === "refunded";
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
          money (for the books) and the ids (for support) come after.

          Every fact leads with an icon (DetailRow), so the panel scans as a
          column of glyphs: box, pin, phone, parcel, envelope, purse. The words
          are still there for whoever wants them; the icon is what a seller
          finds with a glance. */}
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
          <DetailRow
            icon={Package}
            label={t("detail.pack")}
            trailing={<CopyButton value={packText} messages={copyMessages.copyPack} />}
          >
            <p className="break-words text-sm font-medium text-foreground" data-order-pack="">
              {packLine}
            </p>
            {order.selection.length > 0 && <SelectionList order={order} />}
          </DetailRow>
        ) : (
          // Nothing to pack for a download, but the version still says which
          // file the buyer paid for. Absent for a product sold in one version.
          order.selection.length > 0 && (
            <DetailRow
              icon={Layers}
              label={t("detail.version")}
              trailing={
                <CopyButton
                  value={formatOrderSelection(order.selection)}
                  messages={copyMessages.copyVersion}
                />
              }
            >
              <SelectionList order={order} />
            </DetailRow>
          )
        )}

        {ships &&
          (address ? (
            <>
              {/* One copy button for the whole label, laid out as the
                  destination's post expects: paste it straight into a
                  carrier's form or onto a label. */}
              <DetailRow
                icon={MapPin}
                label={t("detail.shipTo")}
                trailing={<CopyButton value={address} messages={copyMessages.copyAddress} />}
              >
                <address
                  className="whitespace-pre-line break-words text-sm not-italic text-foreground"
                  data-order-ship-to=""
                >
                  {address}
                </address>
              </DetailRow>
              {order.shipTo?.phone && (
                <DetailRow
                  icon={Phone}
                  trailing={
                    <CopyButton value={order.shipTo.phone} messages={copyMessages.copyPhone} />
                  }
                >
                  <span className="break-all text-sm text-foreground">{order.shipTo.phone}</span>
                </DetailRow>
              )}
            </>
          ) : (
            <DetailRow icon={MapPin} label={t("detail.shipTo")}>
              <div className="flex flex-col items-start gap-2">
                <p className={helpTextClass}>{t("detail.noAddress")}</p>
                <EmailBuyerLink order={order} />
              </div>
            </DetailRow>
          ))}

        {ships && order.giftMessage && (
          <DetailRow icon={Gift} label={t("detail.giftMessage")}>
            {/* Quoted and whitespace-pre-line: the buyer's own words, untouched. */}
            <p className="whitespace-pre-line text-sm text-foreground">{order.giftMessage}</p>
          </DetailRow>
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

        {/* The shipping step is its own picture: the truck button, or the
            shipped state. Its label is for screen readers; the button says it. */}
        <div className="flex flex-col gap-1.5">
          <span className="sr-only">{t("detail.shipping")}</span>
          <OrderShipping
            order={order}
            canFulfil={canFulfil}
            onOrderChange={onOrderChange}
            onNext={onNext}
            queueDone={queueDone}
            withdrawn={order.withdrawalRequestedAt !== null}
          />
        </div>

        {/* Everything below is for the books and for support, so it sits apart
            from the parcel under a rule. */}
        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <DetailRow
            icon={Mail}
            label={t("detail.buyerEmail")}
            trailing={
              order.buyerEmail ? (
                <CopyButton value={order.buyerEmail} messages={copyMessages.copyBuyerEmail} />
              ) : undefined
            }
          >
            {order.buyerEmail ? (
              // Copyable: the buyer's email is the thing a seller reaches for
              // when answering a support message about this order.
              <span className="break-all text-sm text-foreground">{order.buyerEmail}</span>
            ) : (
              <span className="text-sm text-muted-foreground">{t("detail.noEmail")}</span>
            )}
          </DetailRow>

          {/* THE MONEY, as a ledger: what was paid, what came off, what the
              platform kept, and what is yours (or, once refunded, what went
              back), on one line each. */}
          <DetailRow icon={Wallet}>
            <dl className="flex flex-col gap-1.5 text-sm">
              <LedgerLine label={t("detail.amount")}>
                {formatCents(order.amountCents, order.currency, locale)}
              </LedgerLine>
              {order.discount && (
                // Which discount the buyer got, and the code (the channel) they
                // came with, even when a sale beat it.
                <LedgerLine label={t("detail.discount")}>
                  <span className="flex flex-col items-end" data-order-discount="">
                    {order.discount.cents > 0 && (
                      <span>
                        {order.discount.byCode && order.discount.code
                          ? t("detail.discountCode", {
                              code: order.discount.code,
                              amount: formatCents(order.discount.cents, order.currency, locale),
                            })
                          : t("detail.discountSale", {
                              amount: formatCents(order.discount.cents, order.currency, locale),
                            })}
                      </span>
                    )}
                    {order.discount.code && !order.discount.byCode && (
                      <span className="text-muted-foreground">
                        {t("detail.discountCodeOutdone", { code: order.discount.code })}
                      </span>
                    )}
                  </span>
                </LedgerLine>
              )}
              <LedgerLine
                label={
                  // The rate the sale was charged at, when the order recorded it
                  // (every order since plans; older ones show the bare label).
                  order.platformFeeBps !== null
                    ? t("detail.platformFeeRate", {
                        rate: formatFeeRate(order.platformFeeBps, locale),
                      })
                    : t("detail.platformFee")
                }
              >
                {formatCents(order.platformFeeCents, order.currency, locale)}
              </LedgerLine>
              {refunded ? (
                <LedgerLine label={t("status.refunded")} strong>
                  {formatCents(order.amountCents, order.currency, locale)}
                </LedgerLine>
              ) : (
                // Stripe's card fee is Stripe's to take and is not on the
                // order, so say it is still to come rather than hide it.
                <LedgerLine label={t("detail.youReceive")} strong hint={t("detail.youReceiveHint")}>
                  {formatCents(youReceiveCents, order.currency, locale)}
                </LedgerLine>
              )}
            </dl>
          </DetailRow>

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-inter text-sm text-muted-foreground">
            <MetaItem icon={CHANNEL_ICONS[order.channel]} label={t("detail.channel")}>
              {t(`channel.${order.channel}`)}
            </MetaItem>
            <MetaItem icon={CalendarDays} label={t("detail.date")}>
              {formatOrderDateTime(order.createdAt, locale)}
            </MetaItem>
          </ul>

          <div className="flex items-center gap-1 text-muted-foreground">
            <Hash className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">{t("detail.orderId")}</span>
            <span className="min-w-0 break-all font-mono text-xs">{order.id}</span>
            <CopyButton value={order.id} messages={copyMessages.copyOrderId} />
          </div>
        </div>
      </div>

      {/* Footer: what can be done to the order beyond shipping it. Not for a
          member who cannot fulfil: a viewer was offered a red Refund button
          they could press and be refused by, and read-only means no controls. */}
      {canFulfil && (
        <div className="mt-auto border-t border-border px-4 py-3">
          <OrderActions order={order} onOrderChange={onOrderChange} />
        </div>
      )}
    </div>
  );
}
