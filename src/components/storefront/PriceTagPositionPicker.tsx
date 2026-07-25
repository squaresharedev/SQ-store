"use client";

import { EyeOff } from "lucide-react";
import {
  PRICE_TAG_CORNER_LIMIT,
  PRICE_TAG_FLOAT_POSITIONS,
  type PriceTagFloatPosition,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { PRICE_TAG_FLOAT_CLASSES } from "./config-maps";
import { OptionCardPicker } from "./OptionCardPicker";

/** The three placement modes the mode picker offers; "float" opens the
 *  per-spot picker below it. */
export type PriceTagMode = "below" | "float" | "hidden";

const MODE_LABELS: Record<PriceTagMode, string> = {
  below: "Below",
  float: "On image",
  hidden: "Hidden",
};

/** Miniature card depicting one placement mode: an image area over an info
 *  bar, with the tag pill drawn where that mode puts it. */
function ModeGlyph({ mode }: { mode: PriceTagMode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-10 flex-col overflow-hidden rounded-sm border border-border bg-background"
    >
      <span className="relative flex-1 bg-muted">
        {mode === "float" && (
          <span className="absolute bottom-1 left-1 h-1.5 w-4 rounded-full bg-foreground/80" />
        )}
        {mode === "hidden" && (
          <EyeOff
            className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
        )}
      </span>
      <span className="flex h-3.5 items-center justify-end border-t border-border bg-background px-1">
        {mode === "below" && (
          <span className="h-1.5 w-4 rounded-full bg-foreground/80" />
        )}
      </span>
    </span>
  );
}

/**
 * Visual mode picker for price tag placement: three mini cards showing the
 * tag below the image, floating on the image, or hidden.
 */
export function PriceTagModePicker({
  value,
  onChange,
}: {
  value: PriceTagMode;
  onChange: (mode: PriceTagMode) => void;
}) {
  return (
    <OptionCardPicker
      value={value}
      options={(Object.keys(MODE_LABELS) as PriceTagMode[]).map((mode) => ({
        value: mode,
        label: MODE_LABELS[mode],
        glyph: <ModeGlyph mode={mode} />,
      }))}
      onChange={onChange}
      ariaLabel="Price tag placement"
    />
  );
}

const FLOAT_POSITION_LABELS: Record<PriceTagFloatPosition, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-center": "Middle",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

/** Spots offered on heavily rounded tiles: only the center vertical axis
 *  (the clip removes the corners). Softer tiles offer all 7 spots. */
const AXIS_POSITIONS: readonly PriceTagFloatPosition[] = [
  "top-center",
  "middle-center",
  "bottom-center",
];

/**
 * Visual spot picker for the floating price tag: a miniature card at the
 * current corner roundness with a dot at each available spot. Click a dot to
 * place the tag there. The dot layout reuses the exact placement classes the
 * real tile renders with, so what you pick is what you get.
 */
export function PriceTagPositionPicker({
  value,
  cornerRadius,
  onChange,
}: {
  value: PriceTagFloatPosition;
  cornerRadius: number;
  onChange: (position: PriceTagFloatPosition) => void;
}) {
  const positions =
    cornerRadius >= PRICE_TAG_CORNER_LIMIT
      ? AXIS_POSITIONS
      : PRICE_TAG_FLOAT_POSITIONS;

  return (
    <div
      role="group"
      aria-label="Price tag spot"
      style={{ borderRadius: cornerRadius }}
      className="relative h-24 w-24 border border-border bg-muted"
    >
      {positions.map((position) => {
        const selected = position === value;
        return (
          <button
            key={position}
            type="button"
            onClick={() => onChange(position)}
            aria-label={`Price tag ${FLOAT_POSITION_LABELS[position].toLowerCase()}`}
            aria-pressed={selected}
            className={cn(
              "absolute z-10 flex size-5 items-center justify-center rounded-full transition-colors duration-180 ease-in-out hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              PRICE_TAG_FLOAT_CLASSES[position],
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "rounded-full",
                selected
                  ? "size-3 bg-primary"
                  : "size-2 border border-muted-foreground bg-background",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
