"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fieldBaseClass,
  overlayItemClass,
  overlaySurfaceClass,
} from "@/components/ui/control-styles";
import { storefrontOverlayVars } from "./product-page-maps";

/**
 * The product page's dropdown: one control, used by the version picker and the
 * quantity picker.
 *
 * IT IS THE APP'S DROPDOWN, re-skinned rather than re-drawn. Every class here
 * is a shared one — `fieldBaseClass` for the trigger, `overlaySurfaceClass` for
 * the panel, `overlayItemClass` for a row — the same strings ui/Select wears,
 * so this reads as the same control and inherits any change made to them. What
 * differs is the palette, and that is supplied as CSS variables by
 * `storefrontOverlayVars`: the tokens those classes are written in are
 * re-pointed at the seller's own ink and radius on the wrapper below. There is
 * no colour and no corner in this file.
 *
 * WHY NOT ui/Select ITSELF. Its panel is portalled to `document.body` — the
 * right answer in the dashboard, where a menu has to escape a scrolling modal.
 * Here it is the wrong one twice over: a portalled node is outside this
 * wrapper, so it would not inherit the storefront's variables at all, and the
 * editor renders this page inside a `transform: scale()` artboard, where a
 * panel positioned in viewport pixels would be laid over the shrunken preview
 * at full size. An in-flow panel inherits both the variables and the scale.
 * Nothing on this page clips it: the buy box is sticky, not `overflow-hidden`.
 *
 * IT IS STILL A CLOSED LIST, which is what the quantity picker's security
 * argument rests on. `commit` selects by INDEX into the options this component
 * was handed; there is no text path in or out, so the only values it can emit
 * are the ones the server put here.
 */
export type PageSelectOption = {
  value: string;
  label: string;
  /** Shown, greyed, and not selectable — an option a buyer should learn exists
   *  and is gone, rather than wonder whether they missed. */
  disabled?: boolean;
};

export function PageSelect({
  id,
  label,
  value,
  options,
  onChange,
  radius,
  ink,
  className,
}: {
  id?: string;
  /** Accessible name; there is no visible label inside the control. */
  label: string;
  value: string;
  options: readonly PageSelectOption[];
  onChange: (value: string) => void;
  /** The storefront's corner radius and ink — the only two things that make
   *  this control the seller's rather than the dashboard's. */
  radius: number;
  ink: string;
  /** Width, set by the caller: a quantity is two characters, a colour name is
   *  not. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id ?? label}-listbox`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));

  // Close on a press anywhere else. Pointerdown rather than click, so the list
  // is gone before whatever was pressed reacts.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /** The next selectable option in `step` direction, skipping disabled ones and
   *  stopping at the ends rather than wrapping (a list, not a carousel). */
  function move(from: number, step: 1 | -1) {
    for (let index = from + step; index >= 0 && index < options.length; index += step) {
      if (!options[index]?.disabled) return index;
    }
    return from;
  }

  function commit(index: number) {
    const option = options[index];
    // Selecting by index into the array this component was handed is what makes
    // it a closed list; a disabled option commits nothing.
    if (option && !option.disabled) onChange(option.value);
    setOpen(false);
  }

  function openList() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : move(-1, 1));
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => move(index, event.key === "ArrowDown" ? 1 : -1));
        break;
      case "Home":
      case "End":
        event.preventDefault();
        setActiveIndex(event.key === "Home" ? move(-1, 1) : move(options.length, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      // The storefront, as the tokens every class below is written in.
      style={storefrontOverlayVars(ink, radius)}
    >
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={cn(fieldBaseClass, "flex items-center justify-between gap-2 text-left text-sm")}
      >
        <span className="truncate">{options[selectedIndex]?.label ?? ""}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        // A wrapper split in two, on purpose. `overflow-y-auto` and
        // `border-radius` on the SAME element is not reliably clipped —
        // Chrome and Safari both draw the scrollbar thumb's square corners
        // past a rounded edge, so a rounded storefront got a bar poking out
        // above and below the panel. Putting the radius and `overflow-hidden`
        // on this OUTER, non-scrolling box instead makes it a clipping mask:
        // whatever the inner list draws, scrollbar included, is cut to the
        // mask's shape. The inner element stays a plain rectangle and never
        // needs its own radius.
        <div
          className={cn(
            overlaySurfaceClass,
            "absolute left-0 top-full z-30 mt-1 w-full min-w-max overflow-hidden",
            "rounded-[var(--radius-sm)]",
          )}
        >
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            // storefront-scrollbar (globals.css) repoints the thumb to this
            // panel's own tokens instead of the dashboard's acid accent hover
            // — a seller's shop stays white/grey/black, never branded purple.
            className="storefront-scrollbar max-h-56 overflow-y-auto overscroll-contain p-1"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={option.disabled || undefined}
                onPointerMove={() => !option.disabled && setActiveIndex(index)}
                // Commit on pointerdown, before the trigger's blur can close
                // the list out from under the press.
                onPointerDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
                className={cn(
                  overlayItemClass,
                  "cursor-pointer justify-between rounded-[var(--radius-sm)]",
                  index === activeIndex && !option.disabled && "bg-accent",
                  option.disabled && "cursor-not-allowed opacity-45",
                )}
              >
                <span className="truncate">{option.label}</span>
                {index === selectedIndex && (
                  <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
