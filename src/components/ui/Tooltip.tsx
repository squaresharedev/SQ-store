"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { tooltipBubbleClass } from "@/components/ui/control-styles";
import {
  TipArrow,
  tipBubbleStyle,
  useTipPlacement,
} from "@/components/ui/tip-placement";

/**
 * THE HOVER LABEL for an icon-only control: the word the icon is standing in
 * for, shown on hover and on keyboard focus.
 *
 * WHY NOT `title=""`. The browser's own tooltip is styled by the OS, arrives
 * after a second of stillness, and never appears for a keyboard user at all.
 * Next to this product's own bubbles it reads as a different application.
 *
 * NOT AN InfoTip. That one explains something the control does NOT say for
 * itself, waits behind a deliberate press, and stays up to be read. This only
 * repeats the control's own accessible name, so it is decorative by
 * definition: the bubble is `aria-hidden` and the trigger keeps its
 * `aria-label`, which is what a screen reader announces. Two tooltips reading
 * out the same three words is worse than one.
 *
 * TOUCH gets nothing here, deliberately. There is no hover on a phone, and a
 * tap belongs to the button — turning it into "reveal a label, press again to
 * act" would double every press on the layer controls. Copy that a touch user
 * genuinely needs belongs in an InfoTip, which does open on tap.
 *
 * Placement, bubble and point are the shared tooltip system (ui/tip-placement
 * + the tooltip tokens in control-styles), so this and the "?" are one thing.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  /** The word the icon means. Keep it to a few — it renders on one line. */
  label: string;
  /** The control it describes. Give it the same text as its `aria-label`. */
  children: React.ReactNode;
  /**
   * Extra classes for the wrapper, e.g. a grid/flex sizing utility the
   * control itself was carrying before it was wrapped.
   *
   * REQUIRED when the control is out of flow. The anchor below is a real
   * inline-flex box, so wrapping an `absolute`/`fixed` button leaves an empty
   * inline box behind in the parent's flow — a line box the parent did not
   * have before, which pushes everything after it down by a line's height.
   * Move the placement utilities onto the wrapper instead of the control, and
   * the bubble also lands beside the control rather than wherever that
   * collapsed anchor happened to sit.
   */
  className?: string;
}) {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const open = hovered || focused;

  const placement = useTipPlacement(open, anchorRef, bubbleRef);

  // Esc dismisses, exactly as it does for the "?" — a label hanging over the
  // next control is in the way, and the pointer may not be the thing that
  // opened it.
  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setHovered(false);
      setFocused(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <span
      ref={anchorRef}
      // The WRAPPER is the anchor, not the button: a disabled control has
      // `pointer-events: none`, so hovering it reaches this span instead —
      // which is exactly when "why can I not press this" is being asked.
      className={cn("inline-flex", className)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      // React's onFocus/onBlur are focusin/focusout, so they fire for the
      // control inside without needing a ref to it.
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubbleRef}
            aria-hidden="true"
            data-tooltip=""
            style={tipBubbleStyle(placement)}
            className={cn(tooltipBubbleClass, "whitespace-nowrap")}
          >
            {label}
            <TipArrow placement={placement} />
          </div>,
          document.body,
        )}
    </span>
  );
}
