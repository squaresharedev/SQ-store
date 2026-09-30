"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { TruckIcon, useIconHoverProps } from "@/components/ui/action-icons";
import { Button, buttonClassName } from "@/components/ui/button";
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
import {
  ShipConfirmButton,
  shipActionsClass,
  shipMainActionClass,
  shipSideActionClass,
  useShipSequence,
  type ShipState,
} from "./ShipConfirmButton";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
 * The confirm click gets an ending: the truck spins its wheels while the server
 * works, then drives across the button into a "Shipped" state (ShipConfirmButton).
 * The panel only moves on to the shipped view once that has played, so the order
 * is held here for the length of the sequence after the server has said yes.
 * Saving a tracking number later is a plain edit and gets no ceremony.
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
  const [shipState, setShipState] = useState<ShipState>("idle");
  const sequence = useShipSequence();
  const iconHover = useIconHoverProps();

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
    // The truck is mid-journey: a second press must not start a second ship.
    if (pending || shipState !== "idle") return;
    setError(null);
    // Only the first ship gets the truck.
    const drives = !shipped;
    if (drives) setShipState("working");
    startTransition(async () => {
      const [result] = await Promise.all([
        markOrderShipped(order.id, tracking),
        drives ? pause(sequence.revMs) : undefined,
      ]);
      if (!result.ok) {
        setShipState("idle");
        setError(result.error);
        return;
      }
      if (drives) {
        setShipState("delivered");
        await pause(sequence.rollMs);
      }
      toast.success(
        shipped
          ? t(result.buyerEmailed ? "ship.trackingSaved" : "ship.trackingSavedNoEmail")
          : t(result.buyerEmailed ? "ship.shipped" : "ship.shippedNoEmail"),
      );
      if (drives) await pause(sequence.holdMs);
      // Called even if the panel was closed meanwhile: the list must still learn it shipped.
      setEditing(false);
      onOrderChange?.(result.order);
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
      {/* The main button takes all the width it can; Cancel keeps its own size
          on the right, flush with the edge of the field above. */}
      <div className={shipActionsClass}>
        {shipped ? (
          <Button type="submit" disabled={pending} className={shipMainActionClass}>
            {pending && <Spinner className="size-4" />}
            {t("ship.saveTracking")}
          </Button>
        ) : (
          <ShipConfirmButton
            state={shipState}
            label={t("ship.confirm")}
            deliveredLabel={t("fulfilment.shipped")}
          />
        )}
        <Button
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={pending}
          className={shipSideActionClass}
        >
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
      <motion.button
        type="button"
        onClick={open}
        className={buttonClassName("primary", "w-full")}
        {...iconHover}
      >
        <TruckIcon />
        {t("ship.markShipped")}
      </motion.button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {fulfilment.shippedAt ? (
        <p className="flex items-center gap-1.5 text-sm text-foreground">
          <CircleCheck className="size-4 shrink-0 text-success" strokeWidth={2} aria-hidden="true" />
          {t("detail.shippedOn", { date: formatOrderDateTime(fulfilment.shippedAt, locale) })}
        </p>
      ) : (
        <FulfilmentBadge status="shipped" />
      )}
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
