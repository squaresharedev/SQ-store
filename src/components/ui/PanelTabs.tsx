"use client";

/**
 * PanelTabs — the one tab strip the side panels use.
 *
 * Lifted out of LibraryPanel, which hand-rolled this markup: the editor now has
 * two places that switch a panel between whole modes (Library's Uploads/Shapes,
 * the design panel's Selection/Design), and a second hand-rolled tablist would
 * have been the third grouping idiom in one feature.
 *
 * Controlled on purpose. Both callers already own the active tab as state that
 * outlives the strip — Library's tab lives in the designer's `leftPanel` union,
 * and the design panel's follows the canvas selection — so holding it here as
 * well would give the same question two answers.
 *
 * Renders the strip ONLY. The caller renders the matching panel and labels it
 * with `panelProps`, so a tab's contents can sit anywhere in the tree rather
 * than being trapped inside this component's children.
 */

import { cn } from "@/lib/utils";
import { focusRingInsetClass, transitionClass } from "@/components/ui/control-styles";

/** The pairing that ties one tab button to its panel, per the ARIA tabs
 *  pattern. Spread onto the element that renders the active tab's contents. */
export function panelProps(id: string, value: string) {
  return {
    role: "tabpanel" as const,
    id: `${id}-panel-${value}`,
    "aria-labelledby": `${id}-tab-${value}`,
  };
}

export function PanelTabs<T extends string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  /** Namespace for the generated tab/panel ids. Must match the `panelProps`
   *  call that labels the contents. */
  id: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex border-b border-border lg:px-4", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`${id}-tab-${option.value}`}
            aria-selected={active}
            aria-controls={`${id}-panel-${option.value}`}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex-1 rounded-none px-2 py-1.5 text-xs font-medium",
              transitionClass,
              focusRingInsetClass,
              active
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
