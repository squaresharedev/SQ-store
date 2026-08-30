"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  clampTextSize,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import {
  ghostButtonClass,
  infoTextClass,
  labelClass,
  sliderNumberFieldClass,
} from "@/components/ui/control-styles";

/**
 * Free-form text sizing: a slider for choosing by eye plus a number field for
 * typing an exact value, over the whole TEXT_SIZE_MIN..TEXT_SIZE_MAX range.
 *
 * Replaces a five-option Small/Medium/Large/X-Large/Huge select. Both controls
 * write the same bounded integer, so which one a seller reaches for is a matter
 * of taste rather than of what is reachable.
 *
 * AUTO IS A REAL STATE, not the bottom of the range: a block with no size of
 * its own follows its style (heading/subheading/body), and going back to that
 * is one press rather than hunting for the number it used to be. Touching
 * either control leaves Auto, starting from what Auto was rendering.
 */
export function FontSizeField({
  id,
  value,
  autoSize,
  onChange,
}: {
  id: string;
  /** The stored size, or undefined while the block follows its style. */
  value: number | undefined;
  /** What "Auto" renders at, for the label and as the slider's starting point. */
  autoSize: number;
  /** undefined clears the override and goes back to Auto. */
  onChange: (size: number | undefined) => void;
}) {
  const effective = value ?? autoSize;
  // Local draft so a half-typed number ("1" on the way to "18") is not clamped
  // to the minimum under the seller's fingers.
  const [draft, setDraft] = useState<string | null>(null);

  function commit(next: number) {
    setDraft(null);
    onChange(clampTextSize(next));
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-number`} className={labelClass}>
          Size
        </label>
        {value === undefined ? (
          <span className={infoTextClass}>Auto ({autoSize} px)</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              onChange(undefined);
            }}
            className={cn(ghostButtonClass, "px-2 py-1 text-xs")}
          >
            <RotateCcw className="size-3" strokeWidth={2} aria-hidden="true" />
            Auto
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Slider
            min={TEXT_SIZE_MIN}
            max={TEXT_SIZE_MAX}
            value={effective}
            onChange={commit}
            ariaLabel="Font size"
            valueText={`${effective} pixels`}
          />
        </div>
        <input
          id={`${id}-number`}
          type="number"
          inputMode="numeric"
          min={TEXT_SIZE_MIN}
          max={TEXT_SIZE_MAX}
          value={draft ?? effective}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            const parsed = Number(next);
            // Apply live while it is already a usable number; the blur below
            // clamps whatever the seller finally stops on.
            if (
              next !== "" &&
              Number.isFinite(parsed) &&
              parsed >= TEXT_SIZE_MIN &&
              parsed <= TEXT_SIZE_MAX
            ) {
              onChange(Math.round(parsed));
            }
          }}
          onBlur={() => {
            const parsed = Number(draft ?? effective);
            if (draft !== null && Number.isFinite(parsed) && draft !== "") {
              commit(parsed);
            } else {
              setDraft(null);
            }
          }}
          className={sliderNumberFieldClass}
        />
      </div>
    </div>
  );
}
