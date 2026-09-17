"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside `containerRef` while `active`: Tab and Shift+Tab
 * cycle through its focusable elements, and focus that lands outside it (a
 * click on something behind it, a stray programmatic focus) is brought back.
 *
 * For surfaces that are modal but are not the Modal primitive (the guided
 * tour's card sits beside the control it points at, not in a centred dialog).
 * Reads the container at event time, so a container that is re-keyed between
 * steps is still the one trapping.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      // checkVisibility where the browser has it (display: none, hidden
      // ancestors); otherwise every match counts, since a control the card
      // renders is one it means to be reachable.
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) =>
        typeof element.checkVisibility === "function" ? element.checkVisibility() : true,
      );
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const focused = document.activeElement;
      if (!focused || !container.contains(focused)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (focused === first || focused === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onFocusIn(event: FocusEvent) {
      const container = containerRef.current;
      const target = event.target;
      if (!container || !(target instanceof Node) || container.contains(target)) return;
      container.focus({ preventScroll: true });
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [active, containerRef]);
}
