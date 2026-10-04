"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fieldBaseClass,
  focusRingClass,
  secondaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";

export type CheckboxListItem<T extends string> = {
  value: T;
  label: string;
  /** A quieter word after the label (a country code, a price). */
  hint?: string;
};

/**
 * A COMPACT MULTI-SELECT: a one-line summary button that opens an inline,
 * scrollable list of checkboxes. Inline rather than a portalled dropdown, so a
 * long list scrolls inside the page instead of fighting it.
 *
 * Shipping countries (settings/CountryPicker) and a discount's products
 * (discounts/DiscountForm) both use it. Give `filter` a label for a list long
 * enough to need a search box: it narrows the rows by label as you type, and
 * never changes what is chosen.
 */
export function CheckboxListPanel<T extends string>({
  items,
  value,
  onChange,
  summaryLabel,
  disabled,
  filter,
  emptyLabel,
}: {
  items: readonly CheckboxListItem<T>[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  /** What the closed button says (usually a summary of the choice). */
  summaryLabel: string;
  disabled?: boolean;
  /** A search box above the list, labelled with this. */
  filter?: { label: string };
  /** Shown when the filter matches nothing. */
  emptyLabel?: string;
}) {
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = new Set(value);
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter((item) => item.label.toLowerCase().includes(needle)) : items;

  function toggle(item: T) {
    onChange(chosen.has(item) ? value.filter((existing) => existing !== item) : [...value, item]);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        disabled={disabled}
        className={cn(secondaryButtonClass, "w-full justify-between text-left text-sm")}
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{summaryLabel}</span>
        {open ? (
          <ChevronUp className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border border-border bg-background p-2">
          {filter && (
            <input
              type="search"
              aria-label={filter.label}
              placeholder={filter.label}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={fieldBaseClass}
            />
          )}
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto" role="group">
            {visible.map((item) => {
              const id = `${idPrefix}-${item.value}`;
              return (
                <label
                  key={item.value}
                  htmlFor={id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-none px-2 py-1 text-sm text-foreground hover:bg-accent",
                    transitionClass,
                    focusRingClass,
                  )}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={chosen.has(item.value)}
                    onChange={() => toggle(item.value)}
                    className={cn("size-4 shrink-0 accent-foreground", focusRingClass)}
                  />
                  <span className="min-w-0 truncate">
                    {item.label}
                    {item.hint && <span className="ml-1 text-muted-foreground">{item.hint}</span>}
                  </span>
                </label>
              );
            })}
            {visible.length === 0 && emptyLabel && (
              <p className="px-2 py-1 text-sm text-muted-foreground">{emptyLabel}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
