"use client";

import { useState } from "react";
import {
  resolvePriceTagPosition,
  resolveTitlePosition,
  spotRow,
  titleOverlaysImage,
  type PriceTagPosition,
  type SpotRow,
  type TileSpot,
  type TitleStyle,
} from "@/types/storefront";
import {
  nearestTileSpot,
  priceSpots,
  spotAfterArrow,
  spotLabel,
  titleSpots,
  type SpotArrow,
} from "@/lib/storefront/tile-spots";
import { cn } from "@/lib/utils";
import { TILE_SPOT_CLASSES } from "./config-maps";

/**
 * ONE miniature of the tile carrying BOTH tokens, replacing the two separate
 * spot boards the title and the price used to get.
 *
 * Two boards for one tile contradicted the thing they were describing: on the
 * canvas a seller sees the name and the price sharing one frame, and the rule
 * that matters most (they may not sit in the same row) was a sentence under one
 * board rather than something either board could show. Here the title's row is
 * simply missing from the price's choices, so the rule is visible.
 *
 * Both tokens drag, using the same nearestTileSpot maths as the canvas, and
 * both take arrow keys. Nothing here decides anything: the spots on offer and
 * the spots shown as taken come from the same resolvers the renderer uses.
 */

const ROW_CLASSES: Record<SpotRow, string> = {
  top: "top-0",
  middle: "top-1/2 -translate-y-1/2",
  bottom: "bottom-0",
};

type Token = "title" | "price";

export function TileLayoutBoard({
  titleStyle,
  titlePosition,
  showTitle,
  priceTagPosition,
  cornerRadius,
  onTitleChange,
  onPriceChange,
}: {
  titleStyle: TitleStyle;
  titlePosition: TileSpot;
  showTitle: boolean;
  /** `below` and `hidden` have no dot: the board shows the title band holding
   *  the price, or no price token at all. */
  priceTagPosition: PriceTagPosition;
  cornerRadius: number;
  onTitleChange: (spot: TileSpot) => void;
  onPriceChange: (spot: TileSpot) => void;
}) {
  const [dragging, setDragging] = useState<Token | null>(null);

  // Resolved, so the board shows what the tile will really draw.
  const titleAt = resolveTitlePosition(titlePosition, { titleStyle, cornerRadius });
  const overlaid = titleOverlaysImage(titleStyle);
  const bandRow = showTitle && overlaid ? spotRow(titleAt) : null;
  const priceAt = resolvePriceTagPosition(priceTagPosition, {
    cornerRadius,
    titleOverlaysImage: overlaid,
    titleRow: showTitle ? spotRow(titleAt) : undefined,
  });

  const titleOptions = titleSpots(titleStyle, cornerRadius);
  const priceOptions = priceSpots(cornerRadius, bandRow);
  const floating = priceAt !== "below" && priceAt !== "hidden";

  function optionsFor(token: Token) {
    return token === "title" ? titleOptions : priceOptions;
  }

  function commit(token: Token, spot: TileSpot) {
    if (token === "title") onTitleChange(spot);
    else onPriceChange(spot);
  }

  /** The board is found from the event rather than held in a ref: the token is
   *  always inside it, and a lookup keeps this readable from a handler without
   *  a ref that lint has to reason about. */
  function handleMove(token: Token, event: React.PointerEvent<HTMLElement>) {
    const board = event.currentTarget.closest("[data-tile-layout-board]");
    if (!board) return;
    const spot = nearestTileSpot(
      event.clientX,
      event.clientY,
      board.getBoundingClientRect(),
      optionsFor(token),
    );
    const at = token === "title" ? titleAt : priceAt;
    if (spot !== at) commit(token, spot);
  }

  /** A token: the title's strip or the price's dot, draggable and arrowable. */
  function tokenProps(token: Token, at: TileSpot) {
    return {
      role: "button" as const,
      tabIndex: 0,
      "aria-label": `${token === "title" ? "Title" : "Price"} at ${spotLabel(at)}. Drag, or use the arrow keys, to move it.`,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        setDragging(token);
        if (typeof event.currentTarget.setPointerCapture === "function") {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Capture is a convenience here: the board is small enough that a
            // drag rarely leaves it, and losing it costs only tracking.
          }
        }
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (dragging !== token || event.buttons === 0) return;
        handleMove(token, event);
      },
      onPointerUp: () => setDragging(null),
      onPointerCancel: () => setDragging(null),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        const next = spotAfterArrow(at, event.key as SpotArrow, optionsFor(token));
        if (next !== at) commit(token, next);
      },
    };
  }

  return (
    <div
      data-tile-layout-board=""
      role="group"
      aria-label="Label positions"
      style={{ borderRadius: cornerRadius }}
      className="relative h-28 w-28 touch-none overflow-hidden border border-border bg-muted"
    >
      {/* The spots each token could still take, so the board reads as a set of
          places rather than as two floating objects. */}
      {titleOptions.map((spot) => (
        <span
          key={`t-${spot}`}
          aria-hidden="true"
          className={cn(
            "absolute size-1 rounded-full bg-foreground/20",
            TILE_SPOT_CLASSES[spot],
          )}
        />
      ))}

      {/* The title: a strip, because that is what it is on the tile. */}
      {showTitle && (
        <span
          {...tokenProps("title", titleAt)}
          className={cn(
            "absolute inset-x-0 flex h-4 cursor-grab items-center bg-foreground/25 px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            ROW_CLASSES[spotRow(titleAt)],
            dragging === "title" && "bg-primary/30",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-1 w-6 rounded-full bg-foreground/70",
              spotRow(titleAt) === "middle" && "mx-auto",
              titleAt.endsWith("-center") && "mx-auto",
              titleAt.endsWith("-right") && "ml-auto",
            )}
          />
        </span>
      )}

      {/* The price: a dot, because that is what it is on the tile. When it sits
          in the band there is no dot to draw, and the band shows it instead. */}
      {floating && (
        <span
          {...tokenProps("price", priceAt as TileSpot)}
          className={cn(
            "absolute flex size-5 cursor-grab items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            TILE_SPOT_CLASSES[priceAt as TileSpot],
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-3 rounded-full bg-primary",
              dragging === "price" && "ring-2 ring-primary/40",
            )}
          />
        </span>
      )}
    </div>
  );
}
