"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CircleQuestionMark } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  infoTipBubbleClass,
  infoTipTriggerClass,
} from "@/components/ui/control-styles";

/**
 * The ONE info tip in the product: a "?" beside a label that reveals a
 * sentence of explanation. Use it instead of a permanent help paragraph
 * whenever the copy explains something only some people need to read —
 * a dense editor panel earns its density by not printing every caveat.
 *
 * Revealed by all three routes so no input method is left out:
 *   - MOUSE: hover the "?" (and a click pins it open, so it survives the
 *     pointer leaving);
 *   - KEYBOARD: Tab to it. Esc closes;
 *   - TOUCH: tap. There is no hover on a phone, so the tap is the only way
 *     in — hence the pointerType guard below and the outside-press close.
 *
 * The bubble is `position: fixed` in a portal on <body>, placed from the
 * trigger's rect. An absolutely-positioned tip is clipped the moment it is
 * used inside anything that scrolls (the storefront designer's side panel,
 * a table), and this component is meant to be safe everywhere.
 */

/** Gap between trigger and bubble, and the room kept against the viewport. */
const GAP = 8;
const EDGE = 8;

export function InfoTip({
  label,
  children,
  className,
}: {
  /** Accessible name for the button, e.g. "Why this reaches other storefronts". */
  label: string;
  /** The explanation. Keep it to a sentence or two. */
  children: React.ReactNode;
  /** Extra classes for the trigger (e.g. alignment in an odd row). */
  className?: string;
}) {
  const tipId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  // Three independent reasons to be open; any one of them keeps it up. Hover
  // alone would strand touch users, and `pinned` alone would make a mouse
  // user click for something a hover should give them.
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const open = hovered || focused || pinned;

  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(
    null,
  );
  // Bumped on scroll/resize so the placement below re-runs and the bubble
  // stays glued to its trigger instead of drifting off it.
  const [reflow, setReflow] = React.useState(0);

  // Placement runs AFTER the bubble is in the DOM: its measured size decides
  // the horizontal clamp and whether it flips above the trigger.
  React.useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const rect = trigger.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;

    const left = Math.max(
      EDGE,
      Math.min(
        rect.left + rect.width / 2 - width / 2,
        window.innerWidth - width - EDGE,
      ),
    );
    const below = rect.bottom + GAP;
    const flip =
      below + height > window.innerHeight - EDGE &&
      rect.top - GAP - height >= EDGE;
    const top = flip ? rect.top - GAP - height : below;

    // Bail when nothing moved. `children` is a fresh ReactNode every render,
    // so this effect must never be the thing that causes the next render.
    setPos((prev) =>
      prev && prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, [open, reflow]);

  React.useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPinned(false);
      setHovered(false);
      triggerRef.current?.blur();
    }
    function onPointerDown(event: PointerEvent) {
      if (triggerRef.current?.contains(event.target as Node)) return;
      setPinned(false);
    }
    function onReflow() {
      setReflow((n) => n + 1);
    }

    document.addEventListener("keydown", onKeyDown);
    // CAPTURE phase, same reason as Popover: the designer canvas stops
    // pointerdown propagation, and a bubble-phase listener would never see
    // the press that should dismiss this.
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        // Touch fires pointerenter on tap too; without the guard the tip
        // would open on hover AND be pinned by the same finger, so the next
        // tap could never close it.
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Stopped so a tip placed inside a clickable card (a tile, a row)
        // cannot also select it.
        onClick={(event) => {
          event.stopPropagation();
          setPinned((current) => !current);
        }}
        className={cn(infoTipTriggerClass, className)}
      >
        <CircleQuestionMark
          className="size-4"
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            // The very first open is a measuring pass: rendered off in the
            // corner and hidden, then placed by the layout effect before the
            // browser paints, so it never appears in the wrong spot. Later
            // opens reuse the last placement for that one pre-paint frame,
            // which is why `pos` is not cleared on close.
            style={
              pos
                ? { top: pos.top, left: pos.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
            className={infoTipBubbleClass}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
