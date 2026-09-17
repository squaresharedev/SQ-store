"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { helpTextClass, overlayCloseButtonClass, overlayScrimClass, overlaySurfaceClass } from "@/components/ui/control-styles";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Lightweight accessible modal dialog. Renders nothing when closed. On mobile
 * it's a bottom sheet (full-width); from `sm` up it's a centered
 * card. Esc and backdrop-click close it, focus is moved in on open and trapped,
 * and background scroll is locked.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();

  // `document` exists on the client's very first (hydration) render, not just
  // after mount, so branching on it directly would make that render disagree
  // with the server's (which always sees `document === undefined`) whenever
  // `open` starts `true` — a hydration mismatch. Gating on a state flag that
  // only flips in an effect keeps the hydration render's output (null)
  // identical on both sides; the portal appears a tick later, post-mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog.
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      // Simple focus trap.
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) return;
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

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  // Portalled to `document.body` rather than rendered in place: a caller
  // opened from inside another `<form>` (the product form's shipping modal
  // is the first case) would otherwise nest this modal's own `<form>` inside
  // it, which is invalid HTML and breaks both forms' submit handling. The
  // overlay was always positioned `fixed` relative to the viewport, never to
  // its DOM parent, so moving it has no visual effect for any existing caller.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden onClick={onClose} className={overlayScrimClass} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        // React bubbles a portalled child's synthetic events through the REACT
        // tree, not the DOM tree it actually rendered into — so a `<form>`
        // inside this panel would otherwise still reach an ancestor form's
        // own `onSubmit` (which typically calls `preventDefault()` for ITS
        // OWN submission), silently swallowing this one before its `action`
        // ever runs. Stopping it here makes every modal a self-contained
        // event boundary, regardless of where it happens to be opened from.
        onSubmit={(event) => event.stopPropagation()}
        className={cn(
          overlaySurfaceClass,
          "relative z-10 max-h-[90vh] w-full overflow-y-auto p-6 sm:max-w-md",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold tracking-tight text-popover-foreground"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                className={cn(helpTextClass, "mt-1")}
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(overlayCloseButtonClass, "-mr-1.5 -mt-1.5")}
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
