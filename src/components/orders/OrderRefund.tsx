"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Info, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/Toast";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, infoTextClass, labelClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { refundOrder } from "@/lib/orders/actions";
import { formatOrderDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import type { ActionError } from "@/lib/errors";
import type { Locale } from "@/i18n/locales";
import { REFUND_REASONS, type OrderView, type RefundReason } from "@/types/order-view";
import { useCanRefundOrders } from "./OrderRefundProvider";

/**
 * TAKING AN ORDER BACK: the seller's second write on an order, after shipping.
 *
 * One action for the three things a seller means by it (cancelling before it is
 * sent, refunding a return, anything else), because they all end the same way:
 * the order leaves the To ship queue and the sales figures, the buyer is told,
 * and the units can go back on the shelf.
 *
 * Two clicks, like marking shipped, and for the same reason: it mails a
 * stranger and cannot be taken back. The first opens the form (why, and whether
 * to restock); the second does it.
 *
 * WHERE THE MONEY GOES is the form's first line, because it is the one thing
 * nobody may be wrong about. An order a payment provider charged is refunded
 * through it, to the buyer's card. One no provider charged is only RECORDED:
 * the money was never ours to move, and the seller pays it back themselves.
 *
 * An owner's action (orders.refund). Everyone else sees where the order
 * stands and who can change it.
 */
export function OrderRefund({
  order,
  onOrderChange,
}: {
  order: OrderView;
  /** The order as it stands after the refund, for the panel's owner to keep. */
  onOrderChange?: (order: OrderView) => void;
}) {
  const t = useTranslations("Orders.refund");
  const tCommon = useTranslations("Common.actions");
  const locale = useLocale() as Locale;
  const toast = useToast();
  const canRefund = useCanRefundOrders();
  const reasonId = useId();
  const restockId = useId();
  const openerRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  // A parcel that never left is being cancelled; one that did is coming back.
  const sent = order.fulfilment.status === "shipped";
  const [reason, setReason] = useState<RefundReason>(sent ? "returned" : "cancelled");
  // Back on the shelf by default only when it never left it.
  const [restock, setRestock] = useState(!sent);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();
  // Set by Cancel, read once the opener is back on screen. A ref, not state:
  // nothing is drawn from it.
  const returnFocusRef = useRef(false);

  // Back to the button that opened the form once a cancel has closed it, so a
  // keyboard user is not dropped at the top of the page.
  useEffect(() => {
    if (editing || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    openerRef.current?.focus();
  }, [editing]);

  if (order.refund) {
    return (
      <p className={cn(infoTextClass, "flex items-start gap-1.5")} data-order-refunded="">
        <Undo2 className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        {order.refund.reason
          ? t("refundedOnReason", {
              date: formatOrderDate(order.refund.at, locale),
              reason: order.refund.reason,
            })
          : t("refundedOn", { date: formatOrderDate(order.refund.at, locale) })}
      </p>
    );
  }
  if (order.status !== "paid") return null;
  if (!canRefund) return <p className={helpTextClass}>{t("ownerOnly")}</p>;

  const amount = formatCents(order.amountCents, order.currency, locale);
  const reasonOptions: SelectOption<RefundReason>[] = REFUND_REASONS.map((value) => ({
    value,
    label: t(`reasons.${value}`),
  }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await refundOrder(order.id, reason, restock && order.stockReserved > 0);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t(order.paidThroughProvider ? "refunded" : "recorded"), {
        lines: [t(result.buyerEmailed ? "buyerEmailed" : "buyerNotEmailed")],
      });
      setEditing(false);
      onOrderChange?.(result.order);
    });
  }

  if (!editing) {
    return (
      // A plain button, styled as one: this is the element focus returns to,
      // and the shared Button does not hand its ref on.
      <button
        ref={openerRef}
        type="button"
        onClick={() => setEditing(true)}
        className={buttonClassName("secondary", "w-fit")}
        data-order-refund-open=""
      >
        <Undo2 className="size-4" strokeWidth={2} aria-hidden="true" />
        {t("open")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-order-refund-form="">
      {/* First, and kept on screen: what pressing the button does, and does NOT. */}
      <p
        className={cn(infoTextClass, "flex items-start gap-1.5")}
        data-order-refund-how={order.paidThroughProvider ? "provider" : "manual"}
      >
        <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        {t(order.paidThroughProvider ? "viaProvider" : "manual")}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>{t("reasonLabel")}</Label>
        <Select id={reasonId} value={reason} options={reasonOptions} onChange={setReason} disabled={pending} />
      </div>
      {/* Only an order that is holding units has any to give back. */}
      {order.stockReserved > 0 && (
        <div className="flex items-center gap-3">
          <label htmlFor={restockId} className={cn(labelClass, "flex-1")}>
            {t("restock", { count: order.stockReserved })}
          </label>
          <Switch id={restockId} checked={restock} onCheckedChange={setRestock} disabled={pending} />
        </div>
      )}
      {error && <ActionErrorNotice error={error} variant="inline" />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="destructive" disabled={pending} data-order-refund-confirm="">
          {pending && <Spinner />}
          {t(order.paidThroughProvider ? "confirmProvider" : "confirm", { amount })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            returnFocusRef.current = true;
            setEditing(false);
            setError(null);
          }}
        >
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );
}
