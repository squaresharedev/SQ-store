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
}: {
  value: T;
  options: readonly OptionCard<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex gap-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            className={cn(
              "flex flex-1 flex-col items-center gap-1.5 rounded-none border p-2 transition-colors duration-base ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
              selected
                ? "border-foreground bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            {option.glyph}
            <span
              className={cn(
                "font-inter text-xs",
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
