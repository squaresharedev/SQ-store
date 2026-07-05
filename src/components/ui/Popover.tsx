"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Anchored overlay shared by the DatePicker and ColorPicker. The consumer owns
 * the trigger (and its `aria-haspopup="dialog"` / `aria-expanded`); this
 * component positions the panel under it on desktop and as a full-width bottom
 * sheet on mobile (native pickers shine on touch — don't regress that).
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
  panelClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor element. Must be focusable; focus returns to it on close. */
  trigger: React.ReactNode;
  /** Accessible name for the dialog panel. */
  label: string;
  children: React.ReactNode;
  /** Extra panel classes, e.g. a desktop width (`sm:w-[19rem]`). */
  panelClassName?: string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

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
    if (mobile) document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
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
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative inline-flex w-full flex-col">
      {trigger}
      {open && (
        <>
          <div
            aria-hidden
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            className={cn(
              "z-50 border border-border bg-popover text-popover-foreground shadow-lg focus:outline-none",
              // Mobile: full-width bottom sheet.
              "fixed inset-x-0 bottom-0 w-full rounded-t-lg p-4",
              // Desktop: anchored under the trigger.
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:w-auto sm:rounded-md sm:p-3",
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
