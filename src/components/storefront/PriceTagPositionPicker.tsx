"use client";

import { EyeOff } from "lucide-react";
import {
  PRICE_TAG_FLOAT_POSITIONS,
  spotRow,
  type PriceTagFloatPosition,
  type SpotRow,
} from "@/types/storefront";
import { OptionCardPicker } from "./OptionCardPicker";
import { TileSpotPicker, unclippedSpots } from "./TileSpotPicker";

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

/**
 * Which spots a tile actually has, mirroring resolvePriceTagPosition: the
 * corners go on heavily rounded tiles (the clip removes them), and the title's
 * own row goes when an overlay/shadow band occupies it.
 */
function availablePositions(
  cornerRadius: number,
  titleBand: SpotRow | null,
): readonly PriceTagFloatPosition[] {
  return unclippedSpots(PRICE_TAG_FLOAT_POSITIONS, cornerRadius).filter(
    (position) => spotRow(position) !== titleBand,
  );
}

/**
 * Visual spot picker for the floating price tag, on the shared seven-spot
 * board (see TileSpotPicker). Click a dot to place the tag there; the title
 * band is drawn across whichever row it holds, because that row is exactly the
 * one the tag may not use.
 */
export function PriceTagPositionPicker({
  value,
  cornerRadius,
  titleBand = null,
  onChange,
}: {
  value: PriceTagFloatPosition;
  cornerRadius: number;
  /** Row an overlay/shadow title band covers, or null when the title is a bar
   *  of its own (and so shares none of the image with the tag). */
  titleBand?: SpotRow | null;
  onChange: (position: PriceTagFloatPosition) => void;
}) {
  return (
    <TileSpotPicker
      value={value}
      cornerRadius={cornerRadius}
      available={availablePositions(cornerRadius, titleBand)}
      band={titleBand}
      ariaLabel="Price tag spot"
      spotLabel={(spot) =>
        `Price tag ${FLOAT_POSITION_LABELS[spot].toLowerCase()}`
      }
      onChange={onChange}
    />
  );
}
