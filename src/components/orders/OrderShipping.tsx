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
import { Select, type SelectOption } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { helpTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { markOrderShipped } from "@/lib/orders/actions";
import { CARRIER_OPTIONS, trackingLinkFor } from "@/lib/orders/carriers";
import { formatOrderDateTime } from "@/lib/format/date";
import type { ActionError } from "@/lib/errors";
import { TRACKING_NUMBER_MAX, type CarrierId, type OrderView } from "@/types/order-view";
import { FulfilmentBadge } from "./FulfilmentBadge";
import {
  ShipConfirmButton,
  shipActionsClass,
  shipMainActionClass,
  shipSideActionClass,
  useShipSequence,
  type ShipState,
} from "./ShipConfirmButton";
import { useOrderMailEnabled } from "./OrderMailProvider";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The picker's "none of these": a carrier this app has no tracking page for.
 *  The buyer still gets the number, just not a link. */
const NO_CARRIER = "";
type CarrierChoice = CarrierId | typeof NO_CARRIER;

/** The tracking number as it reads in the panel, linked or not. */
const trackingValueClass = "min-w-0 break-all font-mono text-sm text-foreground";

/**
 * THE SHIPPING STEP of an order: where it stands, and the one button that moves
 * it on.
 *
 * Two clicks, deliberately. "Mark as shipped" opens a small form with the
 * optional tracking number and its carrier, and says what will happen (the
 * buyer gets an email); the second click does it. Marking shipped mails a
 * stranger and cannot be taken back, so it is confirmed, but it is still the
 * whole job: no page, no modal. The number and carrier can be added or changed
 * afterwards the same way, and the buyer is told again when they are.
 *
 * The carrier is a PICK, never a typed link: with a number beside it, the
 * buyer's order page links to that carrier's own tracking page
 * (lib/orders/carriers.ts). It waits for a number, because that is all it
 * describes.
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
  onNext,
  queueDone = false,
  withdrawn = false,
}: {
  order: OrderView;
  canFulfil: boolean;
  /** The buyer has withdrawn from this purchase. Shipping is still possible
   *  (it may have been agreed), but it is no longer the obvious next step, so
   *  the button steps back and the form says why. */
  withdrawn?: boolean;
  /** The order as it stands after a change, for the panel's owner to keep. */
  onOrderChange?: (order: OrderView) => void;
  /** Present when the To ship queue has another order in it: opens that one,
   *  so clearing a queue is one press per parcel instead of close, find, open. */
  onNext?: () => void;
  /** The queue this order came from has nothing else in it. */
  queueDone?: boolean;
}) {
  const t = useTranslations("Orders");
  const tCommon = useTranslations("Common.actions");
  const locale = useLocale();
  const toast = useToast();
  const mailOn = useOrderMailEnabled();
  const inputId = useId();
  const carrierId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(order.fulfilment.trackingNumber ?? "");
  const [carrier, setCarrier] = useState<CarrierChoice>(order.fulfilment.carrier ?? NO_CARRIER);
  const [error, setError] = useState<ActionError | null>(null);
  const [pending, startTransition] = useTransition();
  const [shipState, setShipState] = useState<ShipState>("idle");
  // Where focus goes once the form that had it has gone: the shipped status
  // after a save, the button that opened the form after a cancel. Without it
  // the focused button unmounts and focus falls to the page, which for a
  // keyboard or screen-reader user means starting again from the top.
  const [focusNext, setFocusNext] = useState<"status" | "opener" | null>(null);
  const sequence = useShipSequence();
  const iconHover = useIconHoverProps();

  // Straight into the field when the form opens: the next thing a seller does
  // is paste the number, or press Enter without one.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const { fulfilment } = order;
  const shipped = fulfilment.status === "shipped";

  useEffect(() => {
    if (editing || focusNext === null) return;
    const target = focusNext === "status" ? statusRef.current : openerRef.current;
    // The target only exists once the view has swapped; try again on the next
    // render (shipped flips when the parent takes the new order) rather than
    // dropping the request.
    if (!target) return;
    target.focus();
    setFocusNext(null);
  }, [editing, focusNext, shipped]);

  if (fulfilment.status === "not_required") {
    return <p className={helpTextClass}>{t("detail.nothingToShip")}</p>;
  }
  if (!shipped && order.status !== "paid") {
    return <p className={helpTextClass}>{t(`detail.shipBlocked.${order.status}`)}</p>;
  }

  const hasTracking = tracking.trim() !== "";
  const carrierOptions: SelectOption<CarrierChoice>[] = [
    { value: NO_CARRIER, label: t("ship.carrierOther") },
    ...CARRIER_OPTIONS,
  ];
  // Where this parcel is followed, the same link the buyer's order page shows.
  const trackingLink = trackingLinkFor(fulfilment, order.shipTo);

  function open() {
    setTracking(fulfilment.trackingNumber ?? "");
    setCarrier(fulfilment.carrier ?? NO_CARRIER);
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
        markOrderShipped(order.id, tracking, hasTracking && carrier !== NO_CARRIER ? carrier : null),
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
      setFocusNext("status");
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
            {/* Only promise mail that will be sent. Where this deployment has
                no email switched on the buyer is NOT told, and saying "we'll
                email the buyer" would leave both of them waiting. */}
            {!mailOn
              ? t("ship.mailOff")
              : order.buyerEmail
                ? t("ship.tellsBuyer")
                : t("ship.noBuyerEmail")}
          </p>
        )}
        {!shipped && withdrawn && (
          <p className="font-inter text-sm font-medium text-foreground">
            {t("detail.withdrawnShipWarning")}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={carrierId}>{t("ship.carrierLabel")}</Label>
        <Select
          id={carrierId}
          value={hasTracking ? carrier : NO_CARRIER}
          options={carrierOptions}
          onChange={setCarrier}
          disabled={pending || !hasTracking}
        />
        <p className={helpTextClass}>{t("ship.carrierHint")}</p>
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
          onClick={() => {
            setEditing(false);
            setFocusNext("opener");
          }}
          disabled={pending}
          className={shipSideActionClass}
        >
          {tCommon("cancel")}
        </Button>
      </div>
    </form>
  );

  if (!shipped) {
    // w-fit: the panel's rows are flex columns, and a bare chip in one stretches
    // to the full width, which read as a black bar rather than a status.
    if (!canFulfil) {
      return (
        <div className="w-fit">
          <FulfilmentBadge status="unfulfilled" />
        </div>
      );
    }
    return editing ? (
      form
    ) : (
      <motion.button
        ref={openerRef}
        type="button"
        onClick={open}
        // A withdrawn order is not the obvious next parcel: the seller has to
        // choose to ship it, so the black button steps back to an outline.
        className={buttonClassName(withdrawn ? "secondary" : "primary", "w-full")}
        {...iconHover}
      >
        <TruckIcon />
        {t("ship.markShipped")}
      </motion.button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The place focus lands after a ship or a tracking save (see focusNext),
          so a keyboard or screen-reader user is told where they are instead of
          dropped on the page. */}
      <div ref={statusRef} tabIndex={-1} className="outline-none" data-order-shipped-status="">
        {fulfilment.shippedAt ? (
          <p className="flex items-center gap-1.5 text-sm text-foreground">
            <CircleCheck className="size-4 shrink-0 text-success" strokeWidth={2} aria-hidden="true" />
            {t("detail.shippedOn", { date: formatOrderDateTime(fulfilment.shippedAt, locale) })}
          </p>
        ) : (
          <FulfilmentBadge status="shipped" />
        )}
      </div>
      {fulfilment.trackingNumber && !editing && (
        <div className="flex flex-col gap-0.5">
          <span className={helpTextClass}>
            {trackingLink
              ? t("detail.trackingCarrier", { carrier: trackingLink.carrier })
              : t("detail.trackingNumber")}
          </span>
          <div className="flex items-center gap-1">
            {trackingLink ? (
              <a
                href={trackingLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(trackingValueClass, "underline underline-offset-2 hover:no-underline")}
                data-order-tracking=""
              >
                {fulfilment.trackingNumber}
              </a>
            ) : (
              <span className={trackingValueClass} data-order-tracking="">
                {fulfilment.trackingNumber}
              </span>
            )}
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
          <button
            ref={openerRef}
            type="button"
            onClick={open}
            className={cn(secondaryButtonClass, "w-fit")}
          >
            {fulfilment.trackingNumber ? t("ship.editTracking") : t("ship.addTracking")}
          </button>
        ))}
      {/* Clearing a queue: the next parcel is one press away, and when there is
          none the seller is told they are done rather than left on a panel
          that no longer says what to do. */}
      {!editing && onNext && (
        <Button onClick={onNext} className="w-full">
          {t("ship.next")}
        </Button>
      )}
      {!editing && !onNext && queueDone && (
        <p className={helpTextClass} data-order-queue-done="">
          {t("ship.caughtUp")}
        </p>
      )}
    </div>
  );
}
