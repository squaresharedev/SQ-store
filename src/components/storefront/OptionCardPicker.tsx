"use client";

import { cn } from "@/lib/utils";

export type OptionCard<T extends string> = {
  value: T;
  label: string;
  /** Small aria-hidden illustration of the option. */
  glyph: React.ReactNode;
};

/**
 * Row of visual option buttons: a mini illustration over a caption, one per
 * option. Shared chrome for the Cards section's visual pickers (price tag
 * placement, title style), so they all look and behave identically.
 */
export function OptionCardPicker<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  wrap = false,
}: {
  value: T;
  options: readonly OptionCard<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /**
   * Lay the cards out three to a row instead of all on one.
   *
   * A row of three fits a 320px panel with the captions readable; a row of
   * five does not, and squeezing them turns "Standard" into "Sta...". Past
   * three options the caption is doing the work, so it has to survive.
   */
  wrap?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={wrap ? "grid grid-cols-3 gap-2" : "flex gap-2"}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              // min-w-0 is what lets a row of five fit a 320px panel: without
              // it the caption sets the button's floor and the last card is
              // pushed off the edge.
              "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-none border p-2 transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
              selected
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            {option.glyph}
            <span
              className={cn(
                "max-w-full truncate font-inter text-xs",
                selected
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
