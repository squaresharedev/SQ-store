"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Anchored overlay shared by the DatePicker, ColorPicker, and the top-bar menus.
 * The consumer owns the trigger (and its `aria-haspopup="dialog"` /
 * `aria-expanded`).
 *
 * `variant`:
 *   - "sheet" (default): anchored under the trigger on desktop, full-width
 *     BOTTOM SHEET on mobile (native pickers shine on touch — don't regress it).
 *   - "anchored": a dropdown anchored under the trigger at EVERY breakpoint (the
 *     bell / account menus want the same small popup on mobile as on desktop).
 *
 * While open: focus is moved into the panel (to a `[data-autofocus]` element if
 * present), trapped with Tab/Shift+Tab, and returned to the trigger on close.
 * Esc and any click/tap outside close it.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  children,
  rootClassName,
  panelClassName,
  variant = "sheet",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor element. Must be focusable; focus returns to it on close. */
  trigger: React.ReactNode;
  /** Accessible name for the dialog panel. */
  label: string;
  children: React.ReactNode;
  /**
   * Extra classes for the positioning wrapper. Defaults to filling its column
   * (form fields); pass `w-auto` for a trigger that should hug its content.
   */
  rootClassName?: string;
  /** Extra panel classes, e.g. a width (`sm:w-[19rem]`) or `right-0` anchor. */
  panelClassName?: string;
  variant?: "sheet" | "anchored";
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // The effect below OWNS focus while the popover is open, so it must run once
  // per open/close — never on an unrelated re-render. Consumers routinely pass
  // an inline `onOpenChange`, which changes identity every render; listing it
  // as a dependency would tear down and re-run the effect each time, refocusing
  // the trigger and then snapping focus back to the panel's first control. That
  // makes any panel with a text field unusable (every keystroke re-renders the
  // parent, and focus leaves the field). Read it through a ref instead.
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    // Move focus into the panel — the roving day / first control if it flags
    // itself, else the first focusable, else the panel container.
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    target?.focus();

    // Lock background scroll only for the mobile bottom sheet.
    const mobile = window.matchMedia("(max-width: 639px)").matches;
    const prevOverflow = document.body.style.overflow;
    if (variant === "sheet" && mobile) document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node))
        onOpenChangeRef.current(false);
    }

    document.addEventListener("keydown", onKeyDown);
    // CAPTURE phase, deliberately. In the bubble phase any ancestor that calls
    // stopPropagation on pointerdown (the designer canvas does, to keep a
    // resize gesture from also starting a move) swallows the event before it
    // reaches the document, and the popover stays stuck open. Capturing runs
    // before those handlers, so "click outside closes" holds everywhere.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, variant]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex w-full flex-col", rootClassName)}>
      {trigger}
      {open && (
        <>
          {/* Dimmed backdrop only for the mobile bottom sheet. */}
          {variant === "sheet" && (
            <div
              aria-hidden
              onClick={() => onOpenChange(false)}
              className="fixed inset-0 z-40 bg-black/40 sm:hidden"
            />
          )}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={cn(
              "z-50 border border-border bg-popover text-popover-foreground shadow-lg focus:outline-none",
              variant === "sheet"
                ? // Mobile: full-width bottom sheet; desktop: anchored under the trigger.
                  "fixed inset-x-0 bottom-0 w-full rounded-t-lg p-4 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-auto sm:rounded-md sm:p-3"
                : // Dropdown that never becomes a sheet. Mobile: pinned to the
                  // top-right of the viewport (below the h-14 header), capped to
                  // fit. Desktop: anchored under the trigger, right-aligned.
                  "fixed right-2 top-[3.75rem] max-w-[calc(100vw-1rem)] rounded-md sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:max-w-none",
              panelClassName,
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
