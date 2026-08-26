"use client";

import {
  LAYOUT_PRESETS,
  LAYOUT_PRESET_LABELS,
  LAYOUT_PRESET_VALUES,
  type LayoutPreset,
} from "@/lib/storefront/layout-presets";
import { spotRow } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { OptionCardPicker } from "./OptionCardPicker";

/**
 * The five layouts, as pictures of themselves.
 *
 * This is the primary answer to "where do the name and the price go". The board
 * below it is for the seller who wants a sixth arrangement, and the fine tuning
 * below that is for the one who wants to build their own.
 */

/** Miniature of one preset: a picture area, the title where that preset puts
 *  it, and the price chip where it puts that. Drawn from the preset's own
 *  values rather than hand-posed, so a preset cannot be edited into lying. */
function PresetGlyph({ preset }: { preset: LayoutPreset }) {
  const values = LAYOUT_PRESET_VALUES[preset];
  const overlaid = values.titleStyle !== "bar";
  const row = spotRow(values.titlePosition);
  const bar = values.showTitle && !overlaid;
  const price = values.priceTagPosition;

  const title = values.showTitle ? (
    <span className="h-1 w-5 rounded-full bg-foreground/70" />
  ) : null;

  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-10 flex-col overflow-hidden rounded-sm border border-border bg-background"
    >
      {bar && row === "top" && (
        <span className="flex h-3.5 items-center border-b border-border bg-background px-1">
          {title}
        </span>
      )}
      <span className="relative flex-1 bg-muted">
        {overlaid && values.showTitle && (
          <span
            className={cn(
              "absolute inset-x-0 flex h-3.5 items-center px-1",
              values.titleStyle === "overlay"
                ? "bg-background/85"
                : "bg-gradient-to-t from-neutral-900/70 to-transparent",
              row === "top" ? "top-0" : "bottom-0",
            )}
          >
            {values.titleStyle === "shadow" ? (
              <span className="h-1 w-5 rounded-full bg-background/90" />
            ) : (
              title
            )}
          </span>
        )}
        {price !== "below" && price !== "hidden" && (
          <span
            className={cn(
              "absolute h-1.5 w-3 rounded-full bg-foreground/80",
              spotRow(price) === "top" ? "top-1" : "bottom-1",
              price.endsWith("-left")
                ? "left-1"
                : price.endsWith("-right")
                  ? "right-1"
                  : "left-1/2 -translate-x-1/2",
            )}
          />
        )}
      </span>
      {bar && row === "bottom" && (
        <span className="flex h-3.5 items-center justify-between border-t border-border bg-background px-1">
          {title}
          {price === "below" && (
            <span className="h-1 w-2 rounded-full bg-foreground/80" />
          )}
        </span>
      )}
    </span>
  );
}

export function LayoutPresetPicker({
  value,
  onChange,
}: {
  /** The preset the tile is on, or null once it has been tuned past them all.
   *  Null lights nothing, which is the honest state. */
  value: LayoutPreset | null;
  onChange: (preset: LayoutPreset) => void;
}) {
  return (
    <OptionCardPicker
      // No preset matches: an empty string is a value no option carries, so
      // the row renders with nothing pressed.
      value={value ?? ""}
      options={LAYOUT_PRESETS.map((preset) => ({
        value: preset as string,
        label: LAYOUT_PRESET_LABELS[preset],
        glyph: <PresetGlyph preset={preset} />,
      }))}
      onChange={(next) => onChange(next as LayoutPreset)}
      ariaLabel="Layout"
      wrap
    />
  );
}
