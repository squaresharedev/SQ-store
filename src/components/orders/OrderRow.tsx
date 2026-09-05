"use client";

import { useEffect, useRef } from "react";
import type { OrderView } from "@/types/order-view";
import { cn } from "@/lib/utils";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
import { formatOrderSelection } from "@/lib/orders/selection";

export function OrderRow({
  order,
  onSelect,
  highlighted = false,
}: {
  order: OrderView;
  onSelect: (order: OrderView) => void;
  /** This is the row the user came here for (arrived via `?highlight=`). It is
   *  marked, scrolled to and focused — but NOT opened: the detail panel is one
   *  Enter or one click away, and that press is the user's to make. */
  highlighted?: boolean;
}) {
  const channelLabel =
    order.channel === "marketplace" ? "Marketplace" : "Embed";

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
      <td className="py-2.5 px-3 max-w-xs text-sm">
        <span className="block truncate font-medium text-foreground">
          {order.productTitle}
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

      {/* amount */}
      <td className="py-2.5 px-3 font-inter text-sm text-foreground whitespace-nowrap">
        {formatCents(order.amountCents, order.currency)}
      </td>

      {/* channel — hidden below md */}
      <td className="hidden md:table-cell py-2.5 px-3 font-inter text-sm text-muted-foreground">
        {channelLabel}
      </td>

      {/* status */}
      <td className="py-2.5 px-3">
        <OrderStatusBadge status={order.status} />
      </td>

      {/* buyer — hidden below md */}
      <td className="hidden md:table-cell py-2.5 px-3 font-inter text-sm text-muted-foreground max-w-xs truncate">
        {order.buyerEmail ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </td>

      {/* date */}
      <td className="py-2.5 px-3 font-inter text-sm text-muted-foreground whitespace-nowrap">
        {formatOrderDate(order.createdAt)}
      </td>
    </tr>
  );
}
