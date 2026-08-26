"use client";

import { coerceCornerSpot, type SpotRow, type TileSpot } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { TILE_SPOT_CLASSES } from "./config-maps";

/** Where the band sits inside the miniature card, matching the real tile. */
const BAND_ROW_CLASSES: Record<SpotRow, string> = {
  top: "top-0",
  middle: "top-1/2 -translate-y-1/2",
  bottom: "bottom-0",
};

/**
 * The shared seven-spot board: a miniature card drawn at the tile's current
 * roundness with a dot at each spot that is actually available. Click a dot to
 * put the thing there.
 *
 * ONE component behind both the price tag's picker and the title's, because
 * the two place onto the same board (see TILE_SPOTS) and must not drift into
 * offering different geometry for the same choice. The dot layout reuses the
 * exact placement classes the real tile renders with, so what you pick is what
 * you get — including the title band, which is drawn across whichever row it
 * holds so a tag's spot can be judged against it.
 */
export function TileSpotPicker({
  value,
  cornerRadius,
  available,
  band = null,
  ariaLabel,
  spotLabel,
  onChange,
}: {
  value: TileSpot;
  cornerRadius: number;
  /** The spots this tile really has — see each caller's own rules. */
  available: readonly TileSpot[];
  /** Row the title band covers, drawn as a strip. Null when there is none. */
  band?: SpotRow | null;
  ariaLabel: string;
  spotLabel: (spot: TileSpot) => string;
  onChange: (spot: TileSpot) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ borderRadius: cornerRadius }}
      className="relative h-24 w-24 overflow-hidden border border-border bg-muted"
    >
      {band && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 h-4 bg-foreground/15",
            BAND_ROW_CLASSES[band],
          )}
        />
      )}
      {available.map((spot) => {
        const selected = spot === value;
        return (
          <button
            key={spot}
            type="button"
            onClick={() => onChange(spot)}
            aria-label={spotLabel(spot)}
            aria-pressed={selected}
            className={cn(
              "absolute z-10 flex size-5 items-center justify-center rounded-full transition-colors duration-base ease-standard hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              TILE_SPOT_CLASSES[spot],
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

/** The spots left once the corner rule has had its say: past
 *  CORNER_SPOT_LIMIT the clip removes the corners, so only the center axis
 *  survives. Mirrors coerceCornerSpot rather than restating its threshold —
 *  offering a spot that silently renders somewhere else is worse than not
 *  offering it. */
export function unclippedSpots(
  spots: readonly TileSpot[],
  cornerRadius: number,
): readonly TileSpot[] {
  return spots.filter((spot) => coerceCornerSpot(spot, cornerRadius) === spot);
}
