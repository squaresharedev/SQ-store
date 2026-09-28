"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { markOrderShipped } from "@/lib/orders/actions";
import { formatOrderDateTime } from "@/lib/format/date";
import type { ActionError } from "@/lib/errors";
import { TRACKING_NUMBER_MAX, type OrderView } from "@/types/order-view";
import { FulfilmentBadge } from "./FulfilmentBadge";

/**
 * THE SHIPPING STEP of an order: where it stands, and the one button that moves
 * it on.
 *
 * Two clicks, deliberately. "Mark as shipped" opens a small form with the
 * optional tracking number and says what will happen (the buyer gets an
 * email); the second click does it. Marking shipped mails a stranger and cannot
 * be taken back, so it is confirmed, but it is still the whole job: no page,
 * no modal, no carrier picker. A tracking number can be added or changed
 * afterwards the same way, and the buyer is told again when it is.
 *
 * Members who may not fulfil (viewers) see the state and no controls; the
 * server refuses them regardless (lib/orders/actions.ts).
 */
export function OrderShipping({
  order,
  canFulfil,
  onOrderChange,
}: {
  order: OrderView;
  canFulfil: boolean;
  /** The order as it stands after a change, for the panel's owner to keep. */
  onOrderChange?: (order: OrderView) => void;
}) {
  const t = useTranslations("Orders");
  const tCommon = useTranslations("Common.actions");
  const locale = useLocale();
  const toast = useToast();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(order.fulfilment.trackingNumber ?? "");
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();

  // Straight into the field when the form opens: the next thing a seller does
  // is paste the number, or press Enter without one.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const { fulfilment } = order;
  const shipped = fulfilment.status === "shipped";

  if (fulfilment.status === "not_required") {
    return <p className={helpTextClass}>{t("detail.nothingToShip")}</p>;
  }
  if (!shipped && order.status !== "paid") {
    return <p className={helpTextClass}>{t(`detail.shipBlocked.${order.status}`)}</p>;
  }

  function open() {
    setTracking(fulfilment.trackingNumber ?? "");
    setError(null);
    setEditing(true);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await markOrderShipped(order.id, tracking);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      onOrderChange?.(result.order);
      toast.success(
        shipped
          ? t(result.buyerEmailed ? "ship.trackingSaved" : "ship.trackingSavedNoEmail")
          : t(result.buyerEmailed ? "ship.shipped" : "ship.shippedNoEmail"),
      );
    });
  }

  const form = (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-order-ship-form="">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>{t("ship.trackingLabel")}</Label>
        <Input
          ref={inputRef}
          id={inputId}
          value={tracking}
          onChange={(event) => setTracking(event.target.value)}
          placeholder={t("ship.trackingPlaceholder")}
          maxLength={TRACKING_NUMBER_MAX}
          autoComplete="off"
          spellCheck={false}
          invalid={error !== null}
          disabled={pending}
        />
        {!shipped && (
          <p className={helpTextClass}>
            {order.buyerEmail ? t("ship.tellsBuyer") : t("ship.noBuyerEmail")}
          </p>
        )}
      </div>
      {error && <ActionErrorNotice error={error} variant="inline" />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Spinner className="size-4" />
          ) : (
            !shipped && <Truck className="size-4" strokeWidth={2} aria-hidden="true" />
          )}
          {shipped ? t("ship.saveTracking") : t("ship.confirm")}
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );

  if (!shipped) {
    if (!canFulfil) return <FulfilmentBadge status="unfulfilled" />;
    return editing ? (
      form
    ) : (
      <Button className="w-full" onClick={open}>
        <Truck className="size-4" strokeWidth={2} aria-hidden="true" />
        {t("ship.markShipped")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FulfilmentBadge status="shipped" />
        {fulfilment.shippedAt && (
          <span className="text-sm text-foreground">
            {t("detail.shippedOn", { date: formatOrderDateTime(fulfilment.shippedAt, locale) })}
          </span>
        )}
      </div>
      {fulfilment.trackingNumber && !editing && (
        <div className="flex flex-col gap-0.5">
          <span className={helpTextClass}>{t("detail.trackingNumber")}</span>
          <div className="flex items-center gap-1">
            <span className="min-w-0 break-all font-mono text-sm text-foreground" data-order-tracking="">
              {fulfilment.trackingNumber}
            </span>
            <CopyButton
              value={fulfilment.trackingNumber}
              messages={{
                copy: "Orders.detail.copyTracking.copy",
                copied: "Orders.detail.copyTracking.copied",
                failed: "Orders.detail.copyTracking.failed",
              }}
            />
          </div>
        </div>
      )}
      {canFulfil &&
        (editing ? (
          form
        ) : (
          <button type="button" onClick={open} className={cn(secondaryButtonClass, "w-fit")}>
            {fulfilment.trackingNumber ? t("ship.editTracking") : t("ship.addTracking")}
          </button>
        ))}
    </div>
  );
}
