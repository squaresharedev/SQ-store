"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A glyph that draws its own mini page or tile (the price tag and title style
 *  pickers draw a tile) frames it with this, so every drawn frame matches. */
export const optionGlyphFrameClass = "overflow-hidden rounded-sm border border-border bg-background";

export type OptionCard<T extends string> = {
  value: T;
  label: string;
  /** Small aria-hidden illustration of the option. */
  glyph: React.ReactNode;
};

/**
 * VISUAL CHOICES: a picture of each option, its name underneath.
 *
 * The picture IS the tile: a soft well the glyph sits in, and the whole tile
 * is the button. Choosing one rings its tile in the foreground colour and pins
 * a small check to its corner, and its name goes from muted to foreground, so
 * the choice reads at a glance from any of the three. There is no box around
 * the tile and its caption: a frame around a frame around a drawing was what
 * made these read as clutter.
 *
 * Shared by every visual picker in the design panel (layout presets, price
 * tag placement, title style, the checkout's arrangement), so they all look
 * and behave as one control.
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
   * Lay the tiles out three to a row instead of all on one.
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
      className={wrap ? "grid grid-cols-3 gap-x-2 gap-y-3" : "grid auto-cols-fr grid-flow-col gap-2"}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            // min-w-0 is what lets a row of five fit a 320px panel: without it
            // the caption sets the button's floor and the last tile is pushed
            // off the edge.
            className="group/tile flex min-w-0 flex-col items-center gap-1.5 focus-visible:outline-none"
            data-option-card={option.value}
          >
            <span
              className={cn(
                "relative flex w-full items-center justify-center rounded-md bg-muted/60 px-2 py-3",
                "transition-[box-shadow,background-color] duration-base ease-standard motion-reduce:transition-none",
                "group-focus-visible/tile:ring-2 group-focus-visible/tile:ring-ring group-focus-visible/tile:ring-offset-2 group-focus-visible/tile:ring-offset-background",
                selected
                  ? "bg-accent ring-2 ring-foreground"
                  : "ring-1 ring-border group-hover/tile:bg-accent group-hover/tile:ring-foreground/30",
              )}
            >
              {option.glyph}
              {selected && (
                <span
                  className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-foreground text-background"
                  aria-hidden="true"
                >
                  <Check className="size-2.5" strokeWidth={3.5} />
                </span>
              )}
            </span>
            <span
              className={cn(
                "max-w-full truncate font-inter text-xs",
                selected ? "font-medium text-foreground" : "text-muted-foreground group-hover/tile:text-foreground",
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
