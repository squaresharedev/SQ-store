import { describe, expect, it } from "vitest";
import {
  SPOT_FRACTIONS,
  nearestTileSpot,
  orderedSpots,
  spotAfterArrow,
  spotLabel,
} from "@/lib/storefront/tile-spots";
import {
  CORNER_SPOT_LIMIT,
  TILE_SPOTS,
  coerceCornerSpot,
  type TileSpot,
} from "@/types/storefront";

/**
 * The geometry the drag rests on. Everything here is pure, so these tests are
 * the cheapest place to pin the behaviour a pointer would otherwise have to
 * demonstrate: which spot a position belongs to, and which spot an arrow key
 * reaches. If the drag ever feels wrong, it is wrong here first.
 */

/** A 200x100 tile at an offset, so a bug that confuses x with y shows up. */
const RECT = { left: 40, top: 10, width: 200, height: 100 };

/** The client point a spot's own fraction names, for round-tripping. */
function pointOf(spot: TileSpot) {
  const fraction = SPOT_FRACTIONS[spot];
  return {
    x: RECT.left + fraction.x * RECT.width,
    y: RECT.top + fraction.y * RECT.height,
  };
}

describe("nearestTileSpot", () => {
  it("returns each spot for a pointer sitting exactly on it", () => {
    for (const spot of TILE_SPOTS) {
      const { x, y } = pointOf(spot);
      expect(nearestTileSpot(x, y, RECT, TILE_SPOTS)).toBe(spot);
    }
  });

  it("reads the tile's own corners as the nearest corner spots", () => {
    const corners = [
      [RECT.left, RECT.top, "top-left"],
      [RECT.left + RECT.width, RECT.top, "top-right"],
      [RECT.left, RECT.top + RECT.height, "bottom-left"],
      [RECT.left + RECT.width, RECT.top + RECT.height, "bottom-right"],
    ] as const;
    for (const [x, y, expected] of corners) {
      expect(nearestTileSpot(x, y, RECT, TILE_SPOTS)).toBe(expected);
    }
  });

  it("only ever answers with a spot that was offered", () => {
    // The clipped-corner case: a round tile keeps its center axis and nothing
    // else, so a pointer in a corner must land on the axis rather than on the
    // corner it is closest to.
    const axis = TILE_SPOTS.filter(
      (spot) => coerceCornerSpot(spot, CORNER_SPOT_LIMIT) === spot,
    );
    expect(axis).toHaveLength(3);
    expect(nearestTileSpot(RECT.left, RECT.top, RECT, axis)).toBe("top-center");
    expect(
      nearestTileSpot(RECT.left + RECT.width, RECT.top + RECT.height, RECT, axis),
    ).toBe("bottom-center");
  });

  it("takes the diagonal, not the nearer axis, on a diagonal drag", () => {
    // Two independent band tests would give top-center here, which reads as
    // the token refusing to follow the pointer into the corner.
    const x = RECT.left + 0.78 * RECT.width;
    const y = RECT.top + 0.2 * RECT.height;
    expect(nearestTileSpot(x, y, RECT, TILE_SPOTS)).toBe("top-right");
  });

  it("falls back to the middle rather than throwing on an empty list", () => {
    expect(nearestTileSpot(0, 0, RECT, [])).toBe("middle-center");
  });
});

describe("spotAfterArrow", () => {
  it("moves the way the key points", () => {
    expect(spotAfterArrow("middle-center", "ArrowUp", TILE_SPOTS)).toBe("top-center");
    expect(spotAfterArrow("top-left", "ArrowRight", TILE_SPOTS)).toBe("top-center");
    expect(spotAfterArrow("top-center", "ArrowRight", TILE_SPOTS)).toBe("top-right");
    expect(spotAfterArrow("bottom-right", "ArrowLeft", TILE_SPOTS)).toBe("bottom-center");
    expect(spotAfterArrow("bottom-center", "ArrowUp", TILE_SPOTS)).toBe("middle-center");
  });

  it("holds its column rather than sliding into the middle", () => {
    // There is no middle-left spot, so the spot ABOVE bottom-left really is
    // top-left. Drifting to middle-center on the way would move the token
    // sideways on a keypress that said nothing about sideways.
    expect(spotAfterArrow("bottom-left", "ArrowUp", TILE_SPOTS)).toBe("top-left");
    expect(spotAfterArrow("top-right", "ArrowDown", TILE_SPOTS)).toBe("bottom-right");
  });

  it("still clears the board when the middle is not on offer at all", () => {
    // A `bar` title has no middle row.
    const noMiddle = TILE_SPOTS.filter((spot) => spot !== "middle-center");
    expect(spotAfterArrow("bottom-left", "ArrowUp", noMiddle)).toBe("top-left");
    expect(spotAfterArrow("bottom-center", "ArrowUp", noMiddle)).toBe("top-center");
  });

  it("stops at the edge instead of wrapping", () => {
    // Wrapping on a board this small reads as the token jumping the wrong way.
    expect(spotAfterArrow("top-center", "ArrowUp", TILE_SPOTS)).toBe("top-center");
    expect(spotAfterArrow("bottom-right", "ArrowRight", TILE_SPOTS)).toBe("bottom-right");
    expect(spotAfterArrow("top-left", "ArrowLeft", TILE_SPOTS)).toBe("top-left");
  });

  it("stays put when the only spots left are the one it is on", () => {
    expect(spotAfterArrow("middle-center", "ArrowDown", ["middle-center"])).toBe(
      "middle-center",
    );
  });

  it("reaches every offered spot from every other one", () => {
    // No spot may be a dead end for the keyboard: from anywhere, some sequence
    // of arrows has to arrive anywhere else.
    for (const start of TILE_SPOTS) {
      const seen = new Set<TileSpot>([start]);
      const queue: TileSpot[] = [start];
      while (queue.length > 0) {
        const at = queue.shift()!;
        for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const) {
          const next = spotAfterArrow(at, key, TILE_SPOTS);
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect(seen.size).toBe(TILE_SPOTS.length);
    }
  });
});

describe("orderedSpots", () => {
  it("keeps reading order whatever order the caller filtered in", () => {
    expect(orderedSpots(["bottom-right", "top-left", "middle-center"])).toEqual([
      "top-left",
      "middle-center",
      "bottom-right",
    ]);
  });
});

describe("spotLabel", () => {
  it("speaks each spot the way a person would", () => {
    expect(spotLabel("top-left")).toBe("top left");
    expect(spotLabel("bottom-center")).toBe("bottom center");
    // Not "middle center": there is only one middle, so the column adds nothing.
    expect(spotLabel("middle-center")).toBe("middle");
  });
});
