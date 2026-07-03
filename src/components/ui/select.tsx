"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "./control-styles";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** Optional muted second line under the label. */
  description?: string;
};

/**
 * Custom select with fully styled dropdown children (native <option> can't be
 * themed). Listbox pattern: focus stays on the trigger, arrow keys move the
 * active option, Enter/Space commits, Escape closes. Options render label +
 * optional description with token-styled hover/selected states.
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  function openList() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  // Close when clicking/tapping anywhere outside.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
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
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={cn(fieldBaseClass, "flex items-center justify-between gap-2 text-left")}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-180 ease-in-out motion-reduce:transition-none",
            open && "rotate-180",
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-labelledby={id}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActiveIndex(index)}
                // Select before the trigger's blur can close the list.
                onPointerDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
                className={cn(
                  "flex cursor-pointer items-start justify-between gap-2 rounded-sm px-3 py-2 transition-colors duration-180 ease-in-out motion-reduce:transition-none",
                  isActive && "bg-accent",
                )}
              >
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      isSelected
                        ? "font-medium text-foreground"
                        : "text-foreground",
                    )}
                  >
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block font-inter text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-foreground"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
