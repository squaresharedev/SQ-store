"use client";

import * as React from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  overlayCloseButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { MAX_QUERY_LENGTH } from "@/lib/search/types";

/**
 * THE PARTS EVERY SEARCH COMBOBOX IS BUILT FROM.
 *
 * There are two surfaces that filter an index as you type: the universal
 * palette (SearchOverlay) and the storefront editor's own field
 * (PanelSearchField). They search different indexes on purpose, the palette
 * the whole app and the editor only the designer and its product page, but a
 * seller should not be able to tell them apart by how they look or by what the
 * keys do. So the bar, the row, the group heading and the arrow-key walk live
 * here once, and each surface supplies only its index and what a pick does.
 *
 * The ranking half is shared the same way, one level down, in
 * lib/search/catalog.
 */

/**
 * WHICH ROW IS HIGHLIGHTED, derived rather than stored.
 *
 * State holds only what the user chose with the arrows or the pointer; the row
 * actually highlighted is that choice while it is still in the list, else the
 * first row. Storing the highlight directly and reconciling it in an effect
 * leaves a frame, on every keystroke, where aria-activedescendant names a row
 * that is no longer rendered. Deriving it makes that unrepresentable.
 */
export function useActiveOption(
  ids: readonly string[],
  optionId: (id: string) => string,
) {
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const activeId =
    chosenId && ids.includes(chosenId) ? chosenId : (ids[0] ?? null);

  const move = React.useCallback(
    (delta: 1 | -1) => {
      if (ids.length === 0) return;
      const index = activeId ? ids.indexOf(activeId) : -1;
      const next = ids[(index + delta + ids.length) % ids.length];
      if (!next) return;
      setChosenId(next);
      // getElementById rather than a selector: ids embed a useId value and a
      // row id, and neither is guaranteed to be a valid CSS identifier.
      document
        .getElementById(optionId(next))
        ?.scrollIntoView?.({ block: "nearest" });
    },
    [activeId, ids, optionId],
  );

  return { activeId, choose: setChosenId, move };
}

export type SearchBarClear = {
  label: string;
  onPress: () => void;
  className?: string;
};

/**
 * The input row: magnifier, field, and ONE clear control drawn as an icon.
 *
 * `bar` is the h-9 bordered field (the palette's desktop trigger and the
 * editor panel's field); `sheet` is the roomier full-width row of the mobile
 * palette.
 *
 * type="text", never type="search": the native search input paints its own
 * cancel glyph, which cannot be styled consistently across browsers and would
 * sit beside the X this bar already draws.
 */
export function SearchBar({
  variant,
  inputRef,
  value,
  onValueChange,
  onKeyDown,
  label,
  placeholder,
  listboxId,
  expanded,
  activeDescendant,
  clear,
  trailing,
  className,
}: {
  variant: "bar" | "sheet";
  inputRef?: React.Ref<HTMLInputElement>;
  value: string;
  onValueChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  label: string;
  placeholder: string;
  listboxId: string;
  /** Whether the listbox is rendered with at least one option. */
  expanded: boolean;
  activeDescendant?: string;
  /** Null hides the control entirely. */
  clear?: SearchBarClear | null;
  /** After the clear control, e.g. the palette's shortcut chip. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const bar = variant === "bar";
  return (
    <div
      className={cn(
        bar
          ? "flex h-9 shrink-0 items-center gap-2 rounded-none border border-input bg-background px-3"
          : "flex shrink-0 items-center gap-2 border-b border-border px-4 py-3",
        className,
      )}
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={expanded}
        // Only while the listbox actually exists: naming an element that is
        // not rendered is a dangling reference.
        aria-controls={expanded ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={placeholder}
        // THE CHARACTER LIMIT, in both forms on purpose. `maxLength` is the
        // affordance: the browser refuses the extra character and clamps a
        // paste. The slice is the ENFORCEMENT, because maxLength is not applied
        // to every path that can set a value (an IME composition commits past
        // it in some browsers), and the stored value is what the palette builds
        // its request from. The server 400s past the same constant, which the
        // palette would otherwise report as "can't reach the server". It also
        // bounds the per-keystroke local ranking, which a pasted megabyte turns
        // into a frozen tab.
        maxLength={MAX_QUERY_LENGTH}
        value={value}
        onChange={(event) =>
          onValueChange(event.target.value.slice(0, MAX_QUERY_LENGTH))
        }
        onKeyDown={onKeyDown}
        // text-base below sm: anything under 16px makes iOS Safari zoom the
        // page on focus.
        className={cn(
          "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
          bar ? "text-base sm:text-sm" : "text-base",
        )}
      />
      {clear && (
        <button
          type="button"
          aria-label={clear.label}
          // Keep focus in the input: a blur here would collapse the combobox.
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear.onPress}
          className={cn(
            overlayCloseButtonClass,
            // Inset inside the h-9 bar like a field affordance rather than
            // flush to its borders.
            bar && "-mr-2 size-7",
            clear.className,
          )}
        >
          <X className={bar ? "size-4" : "size-5"} strokeWidth={2} aria-hidden />
        </button>
      )}
      {trailing}
    </div>
  );
}

/** Row padding. `comfortable` is the palette; `compact` fits a 320px editor
 *  column while keeping the 44px touch target below lg. */
export type SearchDensity = "comfortable" | "compact";

export function SearchGroupHeading({
  id,
  label,
  density = "comfortable",
}: {
  id: string;
  label: string;
  density?: SearchDensity;
}) {
  return (
    <p
      id={id}
      className={cn(
        "pb-1 pt-3 font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground",
        density === "comfortable" ? "px-4" : "px-2 pt-2",
      )}
    >
      {label}
    </p>
  );
}

/**
 * One result. A div with role="option", never a button: inside a listbox the
 * only legal child is an option, and an option must not also be a control.
 * Focus stays in the input throughout; this row is reached through
 * aria-activedescendant.
 */
export function SearchOption({
  id,
  active,
  icon: Icon,
  title,
  subtitle,
  trailing,
  density = "comfortable",
  onPick,
  onHover,
}: {
  id: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  subtitle?: string | null;
  trailing?: React.ReactNode;
  density?: SearchDensity;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      // Keep focus in the input when clicking a row, or the combobox collapses
      // before the click lands. MOUSE ONLY: preventing the default on a touch
      // pointerdown also suppresses the synthesized click, so every tap on a
      // phone would silently do nothing.
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") event.preventDefault();
      }}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        // min-h-11 keeps every row a 44px touch target on mobile.
        "flex min-h-11 cursor-pointer items-center",
        density === "comfortable"
          ? "gap-3 px-4 py-2"
          : "gap-2.5 px-2 py-1.5 lg:min-h-9",
        transitionClass,
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        {subtitle && (
          <span className="block truncate font-inter text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
    </div>
  );
}
