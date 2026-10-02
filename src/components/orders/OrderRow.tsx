"use client";

import { useEffect, useRef } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { OrderView, OrdersView } from "@/types/order-view";
import { cn } from "@/lib/utils";
import { badgeClass } from "@/components/ui/surface-styles";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { FulfilmentBadge } from "./FulfilmentBadge";
import { formatCents } from "@/lib/format/money";
import { formatAge, formatOrderDate } from "@/lib/format/date";
import { regionName } from "@/lib/format/country";
import { isOverdue } from "@/lib/orders/fulfilment";
import { formatOrderSelection } from "@/lib/orders/selection";
import { useNow } from "@/lib/hooks/useNow";

export function OrderRow({
  order,
  onSelect,
  highlighted = false,
  view = "all",
}: {
  order: OrderView;
  onSelect: (order: OrderView) => void;
  /** This is the row the user came here for (arrived via `?highlight=`). It is
   *  marked, scrolled to and focused — but NOT opened: the detail panel is one
   *  Enter or one click away, and that press is the user's to make. */
  highlighted?: boolean;
  /** Which list this row is in; decides its middle columns (see OrdersTable). */
  view?: OrdersView;
}) {
  const t = useTranslations("Orders");
  const locale = useLocale();
  // How long it has waited, for the queue only. Null until the browser has a
  // clock (see useNow), so the server render and hydration agree.
  const now = useNow();
  const waiting = view === "to-ship" && now ? formatAge(order.createdAt, locale, now) : null;
  const overdue = view === "to-ship" && now ? isOverdue(order.createdAt, now) : false;
  const channelLabel = t(
    order.channel === "marketplace"
      ? "channel.marketplace"
      : order.channel === "direct"
        ? "channel.direct"
        : "channel.embed",
  );

  // Bring the row to the user rather than making them find the marked one:
  // it can be well down a filtered list. Focus goes with the scroll so the
  // very next Enter opens it, which is the whole point of arriving here.
  // Keyed on the id too, so following a second search result re-runs it.
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    // An explicit `behavior` overrides the stylesheet, so the reduced-motion
    // preference has to be honoured here rather than in globals.css.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    rowRef.current?.scrollIntoView({
      block: "center",
      behavior: reduce ? "auto" : "smooth",
    });
    rowRef.current?.focus({ preventScroll: true });
  }, [highlighted, order.id]);

  return (
    <tr
      ref={rowRef}
      onClick={() => onSelect(order)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSelect(order);
        } else if (e.key === " ") {
          e.preventDefault();
          onSelect(order);
        }
      }}
      tabIndex={0}
      // `aria-current` rather than a visual-only treatment: "the one you were
      // brought to" is exactly what it means, and without it the marking is
      // invisible to anyone not looking at the colour.
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "cursor-pointer transition-colors duration-base motion-reduce:transition-none hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        // The same inset ring the focus state uses, kept ON so the row stays
        // marked after focus moves elsewhere. Hover alone would not do: it is
        // also bg-accent, so a highlight drawn only in background colour reads
        // as "the pointer is here" rather than "this is the one".
        highlighted && "bg-accent ring-2 ring-inset ring-ring",
      )}
    >
      {/* product, and WHICH VERSION OF IT. The version reads under the title
          rather than in a column of its own: it is part of naming the thing
          sold ("the six seater one"), it is empty for most products, and a
          column that is blank on nine rows in ten is a column that earns
          nothing. */}
      {/* Narrower on a phone: at max-w-xs the queue's three columns were 45px wider
          than a 390px screen and the date was cut off at the edge. */}
      <td className="py-2.5 px-3 max-w-40 text-sm sm:max-w-xs">
        {/* "2 × Lamp" when more than one was bought; a lone unit is just
            its name, which is what nearly every row is. */}
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {order.quantity > 1
              ? t("detail.packLine", { quantity: order.quantity, title: order.productTitle })
              : order.productTitle}
          </span>
          {/* The buyer has withdrawn: whatever this row was, it is now a
              conversation, and the list must not read like plain work. */}
          {order.withdrawalRequestedAt && (
            <span
              className={cn(badgeClass, "shrink-0 text-danger-strong")}
              data-order-withdrawn=""
            >
              {t("list.withdrawn")}
            </span>
          )}
        </span>
        {order.selection.length > 0 && (
          <span
            className="block truncate font-inter text-xs text-muted-foreground"
            data-order-selection=""
          >
            {formatOrderSelection(order.selection)}
          </span>
        )}
      </td>

      {view === "to-ship" ? (
        // Where it goes: the name, and the town and country a seller sorts a
        // pile of parcels by. The full label is one click away.
        <td className="py-2.5 px-3 max-w-36 text-sm sm:max-w-xs" data-order-ship-to-summary="">
          {order.shipTo ? (
            <>
              <span className="block truncate text-foreground">{order.shipTo.name}</span>
              <span className="block truncate font-inter text-xs text-muted-foreground">
                {order.shipTo.city}, {regionName(order.shipTo.country, locale) ?? order.shipTo.country}
              </span>
            </>
          ) : (
            <span className="font-inter text-xs text-muted-foreground">{t("table.noAddress")}</span>
          )}
        </td>
      ) : (
        <>
          {/* amount */}
          <td className="py-2.5 px-3 font-inter text-sm text-foreground whitespace-nowrap">
            {formatCents(order.amountCents, order.currency, locale)}
          </td>

          {/* channel — hidden below md */}
          <td className="hidden md:table-cell py-2.5 px-3 font-inter text-sm text-muted-foreground">
            {channelLabel}
          </td>

          {/* status */}
          <td className="py-2.5 px-3">
            <OrderStatusBadge status={order.status} />
          </td>

          {/* shipping. Said only where it means something: an unpaid,
              disputed or refunded order that has not gone is not "to ship" (it
              is not in the queue), and a loud chip on it would ask for work
              the panel then tells the seller not to do. */}
          <td className="py-2.5 px-3">
            {(order.fulfilment.status !== "unfulfilled" || order.status === "paid") && (
              <FulfilmentBadge status={order.fulfilment.status} />
            )}
          </td>
        </>
      )}

      {/* buyer — hidden below md */}
      <td className="hidden md:table-cell py-2.5 px-3 font-inter text-sm text-muted-foreground max-w-xs truncate">
        {order.buyerEmail ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* date, and in the queue how long it has been waiting: the oldest is
          first, and one that has waited past OVERDUE_AFTER_DAYS is said in ink
          so a forgotten parcel does not read like today's. */}
      <td className="py-2.5 px-3 font-inter text-sm text-muted-foreground whitespace-nowrap">
        <span className="block">{formatOrderDate(order.createdAt, locale)}</span>
        {waiting && (
          <span
            className={cn("block text-xs", overdue && "font-medium text-foreground")}
            data-order-waiting={overdue ? "overdue" : "ok"}
          >
            {waiting}
          </span>
        )}
      </td>
    </tr>
  );
}
