"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { CircleQuestionMark } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  infoTipBubbleClass,
  infoTipTriggerClass,
} from "@/components/ui/control-styles";
import {
  TipArrow,
  tipBubbleStyle,
  useTipPlacement,
} from "@/components/ui/tip-placement";

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
 * Placement, the bubble shape and the point back at the trigger are all
 * shared with the hover-label Tooltip (see ui/tip-placement and the tooltip
 * tokens in control-styles), so the product has ONE tooltip, in two lengths.
 *
 * SIBLING, NOT A REPLACEMENT, for <Tooltip>: this one names something the
 * control does not say for itself and is worth reading, so it waits behind a
 * deliberate press and stays up. A Tooltip only repeats an icon's own label.
 */

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

  const placement = useTipPlacement(open, triggerRef, bubbleRef);

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

    document.addEventListener("keydown", onKeyDown);
    // CAPTURE phase, same reason as Popover: the designer canvas stops
    // pointerdown propagation, and a bubble-phase listener would never see
    // the press that should dismiss this.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
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
            style={tipBubbleStyle(placement)}
            className={infoTipBubbleClass}
          >
            {children}
            <TipArrow placement={placement} />
          </div>,
          document.body,
        )}
    </>
  );
}
