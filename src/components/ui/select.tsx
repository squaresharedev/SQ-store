"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "./control-styles";

/** How long consecutive keystrokes count as one type-ahead search. */
const TYPEAHEAD_MS = 600;

/** Panel geometry, in px. See `computePosition` for how they're used. */
const GUTTER = 8; // closest the panel may come to a screen edge
const GAP = 4; // panel-to-trigger offset
const MAX_WIDTH = 352; // 22rem
const MAX_HEIGHT = 256; // 16rem
/** Below this much room underneath, open upwards instead. */
const FLIP_BELOW = 160;
/** Below this much room sideways, anchor to the trigger's other edge instead. */
const FLIP_BESIDE = 200;

type PanelPosition = {
  /** Exactly one of left/right is set — whichever edge the panel is pinned to. */
  left?: number;
  right?: number;
  /** Likewise for top/bottom: `bottom` means the panel opened upwards. */
  top?: number;
  bottom?: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
};

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
 *
 * The panel is PORTALLED to the body and positioned in viewport coordinates.
 * As an in-flow absolute child it was at the mercy of whatever it happened to
 * sit inside: a narrow trigger near the right edge of a phone (the role picker
 * on Team & access) pushed a wider panel off the left of the screen, and any
 * scrolling or `overflow-hidden` ancestor (the modal body, a decorated
 * settings card) simply cut it off. Portalling escapes both, and
 * `computePosition` then keeps the panel inside the viewport on every edge.
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
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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

  /**
   * Where the panel goes, in viewport coordinates.
   *
   * It stays anchored to the trigger edge `align` asked for and simply gets a
   * smaller width cap when that edge is close to the screen — keeping the
   * panel lined up with the control is worth more than the last few rem of
   * width. Only when the requested edge leaves too little room to read does it
   * swap to the trigger's other edge. Either way both the gutters and the
   * anchor are honoured, so the panel is always fully on screen.
   *
   * Vertically it opens downwards unless the room below is cramped and there
   * is more of it above.
   */
  const computePosition = useCallback((): PanelPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    // clientWidth, not innerWidth: it excludes a classic scrollbar's gutter.
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    const roomGrowingRight = vw - GUTTER - rect.left; // pinned to trigger's left
    const roomGrowingLeft = rect.right - GUTTER; // pinned to trigger's right
    const pinRight =
      align === "right"
        ? roomGrowingLeft >= Math.min(FLIP_BESIDE, roomGrowingRight)
        : roomGrowingRight < Math.min(FLIP_BESIDE, roomGrowingLeft);

    const inset = pinRight
      ? Math.max(GUTTER, vw - rect.right)
      : Math.max(GUTTER, rect.left);
    const maxWidth = Math.max(0, Math.min(MAX_WIDTH, vw - GUTTER - inset));

    const below = vh - rect.bottom - GAP - GUTTER;
    const above = rect.top - GAP - GUTTER;
    const flipUp = below < FLIP_BELOW && above > below;

    return {
      ...(pinRight ? { right: inset } : { left: inset }),
      ...(flipUp ? { bottom: vh - rect.top + GAP } : { top: rect.bottom + GAP }),
      // The panel is never narrower than the control that opened it.
      minWidth: Math.min(rect.width, maxWidth),
      maxWidth,
      maxHeight: Math.max(0, Math.min(MAX_HEIGHT, flipUp ? above : below)),
    };
  }, [align]);

  function openList() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    // Measured BEFORE the panel exists, so it renders in place rather than
    // flashing at a stale position for a frame.
    setPosition(computePosition());
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

  // The panel is fixed to the viewport, so anything that moves the trigger
  // under it — a page scroll, the modal body scrolling, a rotate — has to
  // re-anchor it. Capture phase so scrolls inside ancestors count too.
  useEffect(() => {
    if (!open) return;
    const reposition = () => setPosition(computePosition());
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, computePosition]);

  // Close when clicking/tapping anywhere outside. The panel lives in a portal,
  // so "outside" has to exclude it explicitly — it is not inside rootRef.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
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
        setPosition(computePosition());
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
        ref={triggerRef}
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

      {open &&
        position &&
        createPortal(
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={id}
            // Viewport coordinates, clamped by computePosition. z-[60] matches
            // the search overlay: above modals (z-50), since a select inside a
            // modal has to draw over it.
            style={{
              position: "fixed",
              left: position.left,
              right: position.right,
              top: position.top,
              bottom: position.bottom,
              minWidth: position.minWidth,
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
            }}
            className={cn(
              // The panel sizes to its CONTENT (min = the trigger's width), so
              // a two-option list with descriptions doesn't wrap itself into a
              // scrolling column behind a narrow trigger.
              "z-[60] w-max overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 shadow-md",
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
                  // min-h-11: a comfortable thumb target for a one-line option,
                  // which px-3 py-2 alone leaves at about 36px.
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 transition-colors duration-base ease-standard motion-reduce:transition-none",
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
                      className="size-4 shrink-0 text-foreground"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  )}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
