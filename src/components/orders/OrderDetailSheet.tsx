"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { overlayScrimClass } from "@/components/ui/control-styles";
import type { OrderView } from "@/types/order-view";
import { OrderDetail } from "./OrderDetail";

/**
 * One order's detail panel, sliding in over the page from the right. Shared by
 * the Orders list and the overview's Recent orders card, so an order reads the
 * same wherever it was opened from. Esc and the scrim close it; focus moves
 * into the panel on open and goes back to whatever opened it (the row) on close.
 */
export function OrderDetailSheet({
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
  /** Called with the order as it stands after a shipping change, so the
   *  caller's copy (and therefore this panel) shows it at once. */
  onOrderChange?: (order: OrderView) => void;
  /** Opens the next order waiting to ship (the To ship queue only). */
  onNext?: () => void;
  /** The queue this order came from has nothing else in it. */
  queueDone?: boolean;
}) {
  const t = useTranslations("Orders.list");
  const panelRef = useRef<HTMLDivElement>(null);

  // Read at the moment Escape is pressed, so the open effect below does not
  // re-run (and bounce focus) whenever the caller passes a new closure.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The panel itself, not its first control: that is the close button or a
    // copy button, and a stray Space should not act on either.
    panelRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  // Moving on to another order (the queue's "Next order") swaps what the panel
  // shows without closing it. The button that was pressed has gone with the old
  // order, so focus comes back to the panel rather than falling to the page.
  // Keyed on the id only: saving a tracking number replaces the SAME order, and
  // that hand-off belongs to OrderShipping.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [order.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={t("detailDialog")}
    >
      <button
        type="button"
        className={overlayScrimClass}
        aria-label={t("closeDetail")}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative h-full w-full max-w-md shadow-lg outline-none"
      >
        {/* Keyed by order: the shipping step holds its own state (an open
            form, the truck's progress), and it must not carry over from one
            parcel to the next. */}
        <OrderDetail
          key={order.id}
          order={order}
          onClose={onClose}
          canFulfil={canFulfil}
          onOrderChange={onOrderChange}
          onNext={onNext}
          queueDone={queueDone}
        />
      </div>
    </div>
  );
}
