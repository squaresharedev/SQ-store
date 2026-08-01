"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "./control-styles";

/** How long consecutive keystrokes count as one type-ahead search. */
const TYPEAHEAD_MS = 600;

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
  align = "left",
  triggerClassName,
}: {
  id: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Override trigger geometry (height, corners) where it sits beside other controls. */
  triggerClassName?: string;
  /**
   * Which edge the (wider-than-trigger) panel is anchored to. Use "right" for a
   * narrow trigger sitting at the right of its container, so the panel grows
   * inward instead of off the edge.
   */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  // Type-ahead buffer. A native <select> jumps to the first match as you type,
  // and long lists (the EU country picker) are unusable without it. Keystrokes
  // within TYPEAHEAD_MS accumulate, so "ne" reaches Netherlands, not Norway.
  const typeahead = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({
    buffer: "",
    timer: null,
  });

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

  // Keep the active option in view: the panel caps at max-h-64, so on a long
  // list (countries) arrowing past the fold would otherwise move an invisible
  // highlight. "nearest" scrolls only when it actually falls outside.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(`${listboxId}-option-${activeIndex}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listboxId]);

  // Drop any pending type-ahead timer on unmount.
  useEffect(() => {
    const state = typeahead.current;
    return () => {
      if (state.timer) clearTimeout(state.timer);
    };
  }, []);

  /** Move the highlight to the first option matching the accumulated buffer. */
  function runTypeahead(key: string) {
    const state = typeahead.current;
    if (state.timer) clearTimeout(state.timer);
    state.buffer += key.toLowerCase();
    state.timer = setTimeout(() => {
      state.buffer = "";
    }, TYPEAHEAD_MS);

    const match = options.findIndex((option) =>
      option.label.toLowerCase().startsWith(state.buffer),
    );
    if (match >= 0) setActiveIndex(match);
    return match >= 0;
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

  /** A single printable character, i.e. a type-ahead search key. */
  function isSearchKey(event: KeyboardEvent<HTMLButtonElement>) {
    return (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    );
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
        return;
      }
      // Typing on a closed select opens it at the match, like a native one.
      if (isSearchKey(event)) {
        event.preventDefault();
        setOpen(true);
        runTypeahead(event.key);
      }
      return;
    }

    if (isSearchKey(event)) {
      event.preventDefault();
      runTypeahead(event.key);
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
        className={cn(
          fieldBaseClass,
          "flex items-center justify-between gap-2 text-left",
          triggerClassName,
        )}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-base ease-standard motion-reduce:transition-none",
            open && "rotate-180",
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={id}
          className={cn(
            // The panel sizes to its CONTENT (min = the trigger's width), so a
            // two-option list with descriptions doesn't wrap itself into a
            // scrolling column behind a narrow trigger. Capped to the viewport.
            "absolute top-full z-40 mt-1 w-max min-w-full max-w-[min(22rem,calc(100vw-2rem))]",
            "max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md",
            align === "right" ? "right-0" : "left-0",
          )}
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
                  "flex cursor-pointer items-start justify-between gap-2 rounded-sm px-3 py-2 transition-colors duration-base ease-standard motion-reduce:transition-none",
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
