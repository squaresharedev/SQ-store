"use client";

import { FRAME_Z } from "@/components/grid/gridConstants";
import { spotLabel, type SpotArrow } from "@/lib/storefront/tile-spots";
import type { TileSpot } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { TILE_SPOT_CLASSES } from "./config-maps";

/**
 * Dragging the title or the price to a new spot, on the tile itself.
 *
 * The panel's board answers "where can these go"; this answers the question a
 * seller asks first, which is "can I just move it". Both write the same two
 * fields, and both resolve their available spots through lib/storefront/
 * tile-spots, so neither can offer a placement the renderer would move.
 *
 * The gesture lives on the tokens (the title's words, the price chip) rather
 * than on a handle beside them, and it is armed only while the tile is the sole
 * selection. That is what keeps the first press on an unselected tile doing
 * what it has always done: select it, or drag the block.
 */

/** The two things on a product tile that can be placed. */
export type SpotToken = "title" | "price";

/**
 * Where a dragged token wants to land. `below` is the price's own extra home,
 * the title band, which is not a spot on the board: without it, dragging a
 * price out of the band would be a one-way door.
 */
export type SpotDrop = TileSpot | "below";

/**
 * Everything a tile face needs to make its tokens draggable. Absent means a
 * read-only render (a preview, a buyer's page), which is why every field lives
 * behind this one optional bag rather than as six optional props.
 */
export type TileSpotDrag = {
  /** Which tokens are armed. A token that is not armed renders exactly as it
   *  does for a buyer, with no handlers and no affordance. */
  title: boolean;
  price: boolean;
  /** The token in flight and where it currently wants to land, so the tile can
   *  draw the move as it happens rather than on release. */
  active: { token: SpotToken; drop: SpotDrop } | null;
  /** The only pointer event the token reports. Tracking is the owner's job,
   *  on the window, for the reason above. */
  onGrab: (token: SpotToken, event: React.PointerEvent) => void;
  onCancel: () => void;
  onArrow: (token: SpotToken, key: SpotArrow) => void;
  /**
   * A press on a token that ENDED on it. The tile decides what that means: a
   * press that dragged the token has already done its work, and one that did
   * not is a request to edit the thing that was pressed.
   *
   * Either way it is the token's click, never the tile's, so the handler stops
   * it reaching the surface underneath.
   */
  onTokenClick: (token: SpotToken, event: React.MouseEvent) => void;
};

const ARROWS: readonly string[] = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
];

/**
 * WHY THE GESTURE DOES NOT LIVE ON THE TOKEN AFTER THE FIRST EVENT.
 *
 * Pointer capture is the obvious mechanism and it is the wrong one here,
 * because the token MOVES while it is being dragged. Sending a title from the
 * bottom of a `bar` tile to the top re-parents the band from after the picture
 * to before it, React unmounts the old node, and the capture dies with it: the
 * pointerup never arrives and the drop silently commits nothing.
 *
 * So the token only ever reports the grab. Tracking is done with window
 * listeners, which outlive any re-render of the thing being dragged, the same
 * way the grid tracks a block drag.
 */

/** Affordance for an armed token: a grab cursor and a hairline on hover or
 *  focus. Deliberately not a layout change, so arming a tile never reflows the
 *  words a seller is looking at. */
const TOKEN_CLASS =
  "cursor-grab touch-none rounded-sm ring-ring/60 transition-shadow duration-base ease-standard hover:ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";

/**
 * The DOM props that turn a title or price element into a draggable token.
 *
 * `stopPropagation` on pointerdown is the load-bearing line: it is what stops
 * the grid cell reading the press as the start of a block move, the same trick
 * TileImageFramer uses.
 *
 * Arrow keys stop propagating for the same reason: the grid moves the BLOCK
 * with arrows, and a token that is focused has borrowed them.
 */
export function tileSpotTokenProps(
  token: SpotToken,
  drag: TileSpotDrag,
  label: string,
) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    className: TOKEN_CLASS,
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      drag.onGrab(token, event);
    },
    onClick: (event: React.MouseEvent<HTMLElement>) =>
      drag.onTokenClick(token, event),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        drag.onCancel();
        return;
      }
      if (!ARROWS.includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      drag.onArrow(token, event.key as SpotArrow);
    },
  };
}

/** What a token's aria-label says: what it is, where it is, and the two things
 *  pressing it can do. Both are worth naming — moving it is the gesture the
 *  token was built for, and opening its settings is the one a seller reaches
 *  for when the thing they want to change is not its position. */
export function tileSpotTokenLabel(token: SpotToken, drop: SpotDrop): string {
  const what = token === "title" ? "Title" : "Price";
  const where = drop === "below" ? "in the title bar" : `at ${spotLabel(drop)}`;
  return `${what} ${where}. Press to open its settings, or drag (or use the arrow keys) to move it.`;
}

/**
 * The feedback drawn over a tile while one of its tokens is in flight: a dot at
 * every spot the token may land on, with the one it would land on right now
 * filled.
 *
 * It never takes the pointer (the token itself holds the capture), and it sits
 * in the frame band of the z scale, which is the band reserved for one tile
 * lifted out of the board for an in-tile gesture.
 */
export function TileSpotDragLayer({
  available,
  candidate,
}: {
  available: readonly TileSpot[];
  /** Null while the price is hovering its `below` home, where there is no dot
   *  to fill: the band highlights itself instead. */
  candidate: TileSpot | null;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ zIndex: FRAME_Z }}
      className="pointer-events-none absolute inset-0 rounded-[inherit]"
    >
      {available.map((spot) => {
        const on = spot === candidate;
        return (
          <span
            key={spot}
            className={cn(
              "absolute flex size-5 items-center justify-center",
              TILE_SPOT_CLASSES[spot],
            )}
          >
            <span
              className={cn(
                "rounded-full transition-all duration-base ease-standard motion-reduce:transition-none",
                on
                  ? "size-4 bg-primary ring-2 ring-background"
                  : "size-2 bg-foreground/30 ring-1 ring-background",
              )}
            />
          </span>
        );
      })}
    </div>
  );
}
