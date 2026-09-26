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
}: {
  order: OrderView;
  onClose: () => void;
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
        <OrderDetail order={order} onClose={onClose} />
      </div>
    </div>
  );
}
