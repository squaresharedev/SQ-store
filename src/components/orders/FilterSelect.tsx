"use client";

import { useState } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { fieldBaseClass } from "@/components/ui/control-styles";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
  /** Optional colour class for the option icon (e.g. `text-success`). */
  tone?: string;
}

/**
 * On-brand replacement for a native `<select>`: every option carries its own
 * icon (and optional colour tone) so the menu is scannable. Built on the shared
 * Popover, which handles focus trap / outside-click / Esc / the mobile bottom
 * sheet. Used by the Orders status + sort filters.
 */
export function FilterSelect<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  mutedValue,
  triggerClassName,
  panelClassName = "sm:w-56",
}: {
  id?: string;
  /** Accessible name for the popover + listbox. */
  ariaLabel: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  /** Value treated as the "no selection" resting state (label shown muted). */
  mutedValue?: T;
  triggerClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? options[0];
  const CurrentIcon = current.icon;
  const isMuted = mutedValue !== undefined && value === mutedValue;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={ariaLabel}
      panelClassName={panelClassName}
      trigger={
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            fieldBaseClass,
            "flex items-center justify-between gap-2 py-2 text-left",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CurrentIcon
              className={cn("size-4 shrink-0", isMuted ? "text-muted-foreground" : current.tone)}
              aria-hidden="true"
            />
            <span className={cn("truncate text-sm", isMuted && "text-muted-foreground")}>
              {current.label}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-180",
              open && "rotate-180",
            )}
          />
        </button>
      }
    >
      <ul role="listbox" aria-label={ariaLabel} className="flex flex-col gap-0.5">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = option.value === value;
          return (
            <li key={option.value || "default"}>
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-[0.5rem] px-2 py-2 text-left transition-colors duration-180",
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
    </Popover>
  );
}
