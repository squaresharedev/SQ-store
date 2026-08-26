import {
  TILE_SPOTS,
  coerceCornerSpot,
  spotColumn,
  spotRow,
  titleOverlaysImage,
  type SpotRow,
  type TileSpot,
  type TitleStyle,
} from "@/types/storefront";

/**
 * The geometry behind dragging a title or a price tag to one of the seven tile
 * spots (see TILE_SPOTS). Pure, DOM-free and framework-free: the drag on the
 * canvas, the drag inside the panel's miniature board, and the arrow keys that
 * stand in for both all resolve through these three functions, so the three
 * cannot disagree about where a spot is or which one is next.
 */

/**
 * Where each spot's token actually sits, as a fraction of the tile.
 *
 * These are the CENTERS the renderer draws at, expressed the one way that
 * survives a tile of any size: the corner spots come from the `left-2`/`top-2`
 * insets in TILE_SPOT_CLASSES read against a typical tile, and the row values
 * account for a band being a full-width strip rather than a point. Fractions
 * rather than pixels is also what makes the maths immune to the canvas zoom:
 * both the pointer and the tile rect are read in client space, so the scale
 * divides out.
 */
export const SPOT_FRACTIONS: Record<TileSpot, { x: number; y: number }> = {
  "top-left": { x: 0.16, y: 0.12 },
  "top-center": { x: 0.5, y: 0.12 },
  "top-right": { x: 0.84, y: 0.12 },
  "middle-center": { x: 0.5, y: 0.5 },
  "bottom-left": { x: 0.16, y: 0.88 },
  "bottom-center": { x: 0.5, y: 0.88 },
  "bottom-right": { x: 0.84, y: 0.88 },
};

/**
 * The spot nearest a pointer, out of the ones this tile actually offers.
 *
 * Straight-line distance rather than a row band and a column band decided
 * separately: dragging diagonally towards a corner should land on the corner,
 * and two independent axis tests give the corner only when BOTH axes have
 * crossed, which reads as the token refusing to follow.
 *
 * `available` comes from the same resolvers the renderer uses, so a drag can
 * never produce a spot that would then be coerced somewhere else.
 */
export function nearestTileSpot(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  available: readonly TileSpot[],
): TileSpot {
  // An empty list is a programming error rather than a state; the center of
  // the tile is the least surprising thing to hand back if one ever arrives.
  if (available.length === 0) return "middle-center";
  let best = available[0];
  let bestDistance = Infinity;
  for (const spot of available) {
    const fraction = SPOT_FRACTIONS[spot];
    const dx = clientX - (rect.left + fraction.x * rect.width);
    const dy = clientY - (rect.top + fraction.y * rect.height);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = spot;
    }
  }
  return best;
}

/** The four directions an arrow key can mean. */
export type SpotArrow = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * The spot an arrow key moves to: the nearest available one that actually lies
 * in that direction.
 *
 * SPATIAL, not the next entry in a list. Pressing Up on a bottom-left title has
 * to reach the top-left one, and an index walk would reach bottom-center, which
 * is the thing that makes a keyboard equivalent feel like a different feature
 * from the drag rather than the same one.
 *
 * It does NOT wrap. On a board this small a wrap reads as the token jumping the
 * wrong way; stopping at the edge is what a seller can predict, and the edge is
 * one keypress from being visible.
 */
export function spotAfterArrow(
  from: TileSpot,
  key: SpotArrow,
  available: readonly TileSpot[],
): TileSpot {
  const origin = SPOT_FRACTIONS[from];
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;

  let best = from;
  let bestScore = Infinity;
  for (const spot of available) {
    if (spot === from) continue;
    const fraction = SPOT_FRACTIONS[spot];
    const along = horizontal
      ? (fraction.x - origin.x) * sign
      : (fraction.y - origin.y) * sign;
    // Only spots genuinely in the pressed direction are candidates.
    if (along <= 0) continue;
    const across = horizontal
      ? Math.abs(fraction.y - origin.y)
      : Math.abs(fraction.x - origin.x);
    // Drift across the pressed direction costs double, which is what keeps a
    // token in its own column: Up from bottom-left reaches top-left rather
    // than sliding to middle-center, because a key that said nothing about
    // sideways should not move the token sideways.
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = spot;
    }
  }
  return best;
}

/**
 * The spots in reading order, filtered to the ones on offer. The order the
 * board tabs through and the order a screen reader hears, so it matches the
 * order the eye crosses the tile.
 */
export function orderedSpots(
  available: readonly TileSpot[],
): readonly TileSpot[] {
  return TILE_SPOTS.filter((spot) => available.includes(spot));
}

/** A spot named the way it is spoken, for aria labels and announcements. */
export function spotLabel(spot: TileSpot): string {
  const row = spotRow(spot);
  return spot === "middle-center" ? "middle" : `${row} ${spotColumn(spot)}`;
}

/**
 * The spots left once the corner rule has had its say: past CORNER_SPOT_LIMIT
 * the clip removes the corners, so only the center axis survives. Mirrors
 * coerceCornerSpot rather than restating its threshold.
 */
export function unclippedSpots(
  spots: readonly TileSpot[],
  cornerRadius: number,
): readonly TileSpot[] {
  return spots.filter((spot) => coerceCornerSpot(spot, cornerRadius) === spot);
}

/**
 * Where the TITLE may go, mirroring resolveTitlePosition: the corners go on a
 * heavily rounded tile, and the middle row goes for a `bar`, which is a row
 * above or below the picture rather than something drawn on it.
 */
export function titleSpots(
  titleStyle: TitleStyle,
  cornerRadius: number,
): readonly TileSpot[] {
  const overlaid = titleOverlaysImage(titleStyle);
  return unclippedSpots(TILE_SPOTS, cornerRadius).filter(
    (spot) => overlaid || spotRow(spot) !== "middle",
  );
}

/**
 * Where the PRICE may float, mirroring resolvePriceTagPosition: the corners go
 * on a heavily rounded tile, and the row an overlaid title band holds goes
 * because the two would stack.
 *
 * ONE list shared by the drag, the panel board and the old picker, so a spot
 * offered anywhere is a spot the renderer will honour.
 */
export function priceSpots(
  cornerRadius: number,
  titleBand: SpotRow | null,
): readonly TileSpot[] {
  return unclippedSpots(TILE_SPOTS, cornerRadius).filter(
    (spot) => spotRow(spot) !== titleBand,
  );
}
