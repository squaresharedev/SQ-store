"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { fieldBaseClass, secondaryButtonClass } from "@/components/ui/control-styles";
import {
  FilterOptionList,
  type FilterOption,
} from "@/components/ui/FilterOptionList";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

// The option shape lives with the list that renders it; re-exported here so the
// toolbars that already import it from this module keep working.
export type { FilterOption };

/**
 * On-brand replacement for a native `<select>`: every option carries its own
 * icon (and optional colour tone) so the menu is scannable. Built on the shared
 * Popover, which handles focus trap / outside-click / Esc / the mobile bottom
 * sheet. Used by the Orders status + sort filters.
 *
 * `variant`:
 *   - "field" (default): input-styled trigger that fills its column — the
 *     Orders toolbar, where it sits in a row of form controls.
 *   - "button": secondary-button trigger (outlined, sharp, hugs its label) for
 *     placing beside a CTA in a page header rather than inside a form.
 */
export function FilterSelect<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  mutedValue,
  triggerLabel,
  triggerIcon,
  iconOnlyOnMobile = false,
  triggerClassName,
  panelClassName = "sm:w-56",
  variant = "field",
}: {
  id?: string;
  /** Accessible name for the popover + listbox. */
  ariaLabel: string;
  value: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  /** Value treated as the "no selection" resting state (label shown muted). */
  mutedValue?: T;
  /** Fixed trigger text (e.g. "Sort"); defaults to the selected option's label. */
  triggerLabel?: string;
  /**
   * Fixed trigger icon; defaults to the selected option's icon. Pass one when
   * the control itself has an identity (and an animation) of its own.
   */
  triggerIcon?: React.ReactNode;
  /**
   * Collapse the trigger to its icon below `sm`. The label stays in the a11y
   * tree (sr-only), so the button keeps its accessible name on touch.
   */
  iconOnlyOnMobile?: boolean;
  triggerClassName?: string;
  panelClassName?: string;
  variant?: "field" | "button";
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
      // Field variant fills its toolbar column; button variant hugs its label.
      rootClassName={variant === "button" ? "w-auto shrink-0" : undefined}
      panelClassName={panelClassName}
      trigger={
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            variant === "button"
              ? `${secondaryButtonClass} justify-between`
              : cn(fieldBaseClass, "flex items-center justify-between gap-2 py-2 text-left"),
            // Icon-only below sm: drop the horizontal padding to a square.
            iconOnlyOnMobile && "max-sm:gap-0 max-sm:px-2.5",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {triggerIcon ?? (
              <CurrentIcon
                className={cn("size-4 shrink-0", isMuted ? "text-muted-foreground" : current.tone)}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "truncate text-sm",
                isMuted && "text-muted-foreground",
                iconOnlyOnMobile && "max-sm:sr-only",
              )}
            >
              {triggerLabel ?? current.label}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-base",
              open && "rotate-180",
              iconOnlyOnMobile && "max-sm:hidden",
            )}
          />
        </button>
      }
    >
      <FilterOptionList
        ariaLabel={ariaLabel}
        value={value}
        options={options}
        onChange={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </Popover>
  );
}
