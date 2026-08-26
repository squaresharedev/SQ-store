"use client";

import {
  TILE_SPOTS,
  spotRow,
  titleOverlaysImage,
  type TileSpot,
  type TitleStyle,
} from "@/types/storefront";
import { TileSpotPicker, unclippedSpots } from "./TileSpotPicker";

const TITLE_SPOT_LABELS: Record<TileSpot, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "middle-center": "Middle",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};

/**
 * Which spots the title really has, mirroring resolveTitlePosition: the
 * corners go on heavily rounded tiles, and the middle row goes for a `bar`
 * title, which is a row above or below the picture rather than something
 * drawn on it and so has no middle to sit in.
 */
function availableSpots(
  titleStyle: TitleStyle,
  cornerRadius: number,
): readonly TileSpot[] {
  return unclippedSpots(TILE_SPOTS, cornerRadius).filter(
    (spot) => titleOverlaysImage(titleStyle) || spotRow(spot) !== "middle",
  );
}

/**
 * Visual spot picker for the product title, on the same seven-spot board the
 * price tag uses (see TileSpotPicker) — the whole point being that a seller
 * places the two the same way. The band is drawn across the selected row,
 * because the title is a full-width strip rather than a chip: the row says
 * where the strip goes, the column which way the words pull inside it.
 */
export function TitlePositionPicker({
  value,
  titleStyle,
  cornerRadius,
  onChange,
}: {
  value: TileSpot;
  titleStyle: TitleStyle;
  cornerRadius: number;
  onChange: (spot: TileSpot) => void;
}) {
  return (
    <TileSpotPicker
      value={value}
      cornerRadius={cornerRadius}
      available={availableSpots(titleStyle, cornerRadius)}
      band={spotRow(value)}
      ariaLabel="Title spot"
      spotLabel={(spot) => `Title ${TITLE_SPOT_LABELS[spot].toLowerCase()}`}
      onChange={onChange}
    />
  );
}
