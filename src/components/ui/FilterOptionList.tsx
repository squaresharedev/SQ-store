"use client";

import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  /** Optional colour class for the option icon (e.g. `text-success`). */
  tone?: string;
}

/**
 * THE option list inside a filter popover: one icon-tiled row per choice, the
 * selected one tinted and check-marked. Lives on its own so the single-select
 * FilterSelect and the grouped FilterMenu render an identical row — the two
 * controls sit on the same page, and a drifting copy would read as a bug.
 *
 * Exposed as a `listbox` with `option` children, so each list needs its own
 * accessible name when several share a panel.
 */
export function FilterOptionList<T extends string>({
  ariaLabel,
  ariaLabelledBy,
  value,
  options,
  onChange,
}: {
  ariaLabel?: string;
  /** Id of a visible group heading, when one names this list instead. */
  ariaLabelledBy?: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <ul
      role="listbox"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className="flex flex-col gap-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = option.value === value;
        return (
          <li key={option.value || "default"}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[0.5rem] px-2 py-2 text-left transition-colors duration-base",
                isSelected ? "bg-accent" : "hover:bg-accent",
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[0.45rem] bg-secondary">
                <Icon className={cn("size-4", option.tone)} aria-hidden="true" />
              </span>
              <span className="flex-1 font-inter text-sm text-foreground">
                {option.label}
              </span>
              {isSelected && (
                <Check className="size-4 shrink-0 text-foreground" aria-hidden="true" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
