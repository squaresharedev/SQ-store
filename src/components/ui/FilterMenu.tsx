"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import {
  FilterOptionList,
  type FilterOption,
} from "@/components/ui/FilterOptionList";
import { Popover } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

/**
 * One labelled group inside the menu: an independent single-select list.
 *
 * Values are plain strings rather than a generic, because a menu holds groups
 * of DIFFERENT value types (a status and an ordering) in one array, which a
 * single type parameter cannot express. Callers narrow in their `onChange` —
 * a runtime check they want anyway, since these values round-trip through the
 * URL and come back untrusted.
 */
export interface FilterMenuSection {
  /** Visible group heading, and the accessible name of that group's listbox. */
  label: string;
  value: string;
  options: FilterOption<string>[];
  onChange: (value: string) => void;
  /** The value that means "not narrowing anything", e.g. "" or "default".
   *  Anything else counts as applied and shows up in the trigger summary. */
  defaultValue: string;
}

/**
 * Several filter groups behind ONE trigger — the products toolbar folds status
 * and ordering into a single button rather than spending two slots on controls
 * that are usually left alone.
 *
 * The trigger has to earn that consolidation, so it always states what is
 * applied: it reads as its resting label until a group moves off its default,
 * then summarises the applied groups ("Draft · Price: high to low"). Collapsed
 * to an icon on mobile it can't say that, so an accent dot marks "something is
 * filtering here" instead.
 *
 * Selecting does NOT close the panel: these groups compose (pick a status, then
 * an ordering), and a menu that dismissed itself after the first pick would
 * make the second choice cost a second trip.
 */
export function FilterMenu({
  ariaLabel,
  sections,
  restingLabel,
  triggerIcon,
  iconOnlyOnMobile = false,
  triggerClassName,
  panelClassName = "sm:w-64",
}: {
  /** Accessible name for the trigger and the panel. */
  ariaLabel: string;
  sections: FilterMenuSection[];
  /** Trigger text while every group sits at its default. */
  restingLabel: string;
  triggerIcon?: React.ReactNode;
  /** Collapse the trigger to its icon below `sm` (label stays sr-only). */
  iconOnlyOnMobile?: boolean;
  triggerClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  // Applied groups, in section order, so the summary reads the same way the
  // panel does top to bottom.
  const applied = sections
    .filter((section) => section.value !== section.defaultValue)
    .map(
      (section) =>
        section.options.find((option) => option.value === section.value)?.label,
    )
    .filter((label): label is string => Boolean(label));

  const summary = applied.length > 0 ? applied.join(" · ") : restingLabel;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={ariaLabel}
      rootClassName="w-auto shrink-0"
      panelClassName={panelClassName}
      trigger={
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel}
          // The summary can outrun the button; the panel is the full picture
          // and the tooltip covers a pointer user mid-scan.
          title={applied.length > 0 ? summary : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            secondaryButtonClass,
            "relative justify-between",
            // A filtered list looks like a short list, so the control that did
            // it stops being a quiet neutral until it is cleared.
            applied.length > 0 && "border-foreground",
            iconOnlyOnMobile && "max-sm:gap-0 max-sm:px-2.5",
            triggerClassName,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {triggerIcon}
            <span
              className={cn(
                "truncate text-sm",
                iconOnlyOnMobile && "max-sm:sr-only",
              )}
            >
              {summary}
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
          {/* Only where the summary can't be read: the icon-only trigger. */}
          {applied.length > 0 && iconOnlyOnMobile && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 size-2 rounded-full bg-acid sm:hidden"
            />
          )}
        </button>
      }
    >
      {/* Two stacked groups clear a phone's bottom sheet, but the panel scrolls
          rather than trusting that as sections are added. */}
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto sm:max-h-[70vh]">
        {sections.map((section, index) => (
          <div
            key={section.label}
            className={cn(index > 0 && "border-t border-border pt-3")}
          >
            <p
              id={`${headingId}-${index}`}
              className="px-2 pb-1.5 font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {section.label}
            </p>
            <FilterOptionList
              ariaLabelledBy={`${headingId}-${index}`}
              value={section.value}
              options={section.options}
              onChange={section.onChange}
            />
          </div>
        ))}
      </div>
    </Popover>
  );
}
