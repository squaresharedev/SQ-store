"use client";

import { useState } from "react";
import {
  resolvePriceTagPosition,
  resolveTitlePosition,
  spotRow,
  titleBandRow,
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
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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
 * THREE ways to place, all landing on the same commit. Drag a token, click the
 * spot you want it in, or arrow it there. Dragging alone was the gap sellers
 * fell into: a drag on a 128px board is a fiddly gesture on a trackpad and a
 * genuinely hard one on a phone, and the thing a seller reaches for first is
 * pressing the place they want. The click needs to know WHICH label it is
 * placing, which is what the two-segment switch above the board answers — and
 * with only one label on the tile it does not render at all, because there is
 * nothing to disambiguate.
 *
 * Nothing here decides anything: the spots on offer and the spots shown as
 * taken come from the same resolvers the renderer uses.
 */

const ROW_CLASSES: Record<SpotRow, string> = {
  top: "top-0",
  middle: "top-1/2 -translate-y-1/2",
  bottom: "bottom-0",
};

type Token = "title" | "price";

const TOKEN_LABELS: Record<Token, string> = { title: "Title", price: "Price" };

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
  // Which token a click on a spot places. Held as a PREFERENCE rather than as
  // the answer, because the tile can take either token away underneath it: a
  // seller who was moving the price and then hides it must not leave the board
  // aimed at something that is no longer on it.
  const [preferred, setPreferred] = useState<Token>("title");

  // Resolved, so the board shows what the tile will really draw.
  const titleAt = resolveTitlePosition(titlePosition, { titleStyle, cornerRadius });
  // The row the band takes out of the image — NONE when the title is switched
  // off, whatever its style would have drawn. That is the whole of the `bare`
  // layout, where an unseen overlay title used to keep the price off the
  // bottom of its own tile.
  const bandRow = titleBandRow({
    titleStyle,
    titlePosition: titleAt,
    showTitle,
    cornerRadius,
  });
  const priceAt = resolvePriceTagPosition(priceTagPosition, {
    cornerRadius,
    titleBand: bandRow,
  });

  const titleOptions = titleSpots(titleStyle, cornerRadius);
  const priceOptions = priceSpots(cornerRadius, bandRow);
  const floating = priceAt !== "below" && priceAt !== "hidden";

  // The tokens actually on this tile, in the order they read on it.
  const present: Token[] = [
    ...(showTitle ? (["title"] as const) : []),
    ...(floating ? (["price"] as const) : []),
  ];
  const active: Token | null = present.includes(preferred)
    ? preferred
    : (present[0] ?? null);
  const activeAt = active === "title" ? titleAt : (priceAt as TileSpot);

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

  /** A token: the title's strip or the price's dot, draggable and arrowable.
   *  Pressing one also AIMS the board at it, so reaching for the label you
   *  meant to move is the same gesture whether you then drag it or click where
   *  it should go. */
  function tokenProps(token: Token, at: TileSpot) {
    return {
      role: "button" as const,
      tabIndex: 0,
      "aria-label": `${TOKEN_LABELS[token]} at ${spotLabel(at)}. Drag, click a spot, or use the arrow keys, to move it.`,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        setPreferred(token);
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
      onFocus: () => setPreferred(token),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (!event.key.startsWith("Arrow")) return;
        event.preventDefault();
        const next = spotAfterArrow(at, event.key as SpotArrow, optionsFor(token));
        if (next !== at) commit(token, next);
      },
    };
  }

  return (
    <div className="space-y-1.5">
      {/* Only where there is a genuine ambiguity to settle. One label on the
          tile means every spot on the board can only mean that label. */}
      {present.length > 1 && active && (
        <SegmentedControl
          value={active}
          options={present.map((token) => ({
            value: token,
            label: TOKEN_LABELS[token],
          }))}
          onChange={setPreferred}
          ariaLabel="Label to place"
        />
      )}

      <div
        data-tile-layout-board=""
        role="group"
        aria-label="Label positions"
        style={{ borderRadius: cornerRadius }}
        className="relative size-32 touch-none overflow-hidden border border-border bg-muted"
      >
        {/* The title: a strip, because that is what it is on the tile. */}
        {showTitle && (
          <span
            {...tokenProps("title", titleAt)}
            className={cn(
              "absolute inset-x-0 z-10 flex h-4 cursor-grab items-center px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              ROW_CLASSES[spotRow(titleAt)],
              dragging === "title" ? "bg-primary/30" : "bg-foreground/25",
              active === "title" && "ring-1 ring-inset ring-primary/50",
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

        {/* The price: a dot, because that is what it is on the tile. When it
            sits in the band there is no dot to draw, and the band shows it. */}
        {floating && (
          <span
            {...tokenProps("price", priceAt as TileSpot)}
            className={cn(
              "absolute z-10 flex size-7 cursor-grab items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              TILE_SPOT_CLASSES[priceAt as TileSpot],
              active === "price" && "ring-1 ring-primary/50",
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

        {/* The spots the ACTIVE token can still take, as real buttons.
            Rendered last, and above the tokens, for the one case that would
            otherwise be unreachable: the title's strip spans its whole row, so
            the two other columns of that row sit underneath it.

            A spot either token already holds is skipped. Its own spot has to
            be, or the strip and the dot would not be grabbable where they
            actually are — and the OTHER token's has to be too, or a button
            would paint over the very thing it is meant to be placed against,
            leaving the board showing one label where there are two. Pressing
            that token aims the board at it instead, which is the move a seller
            wanted anyway. */}
        {active &&
          optionsFor(active)
            .filter(
              (spot) =>
                spot !== activeAt &&
                !(showTitle && spot === titleAt) &&
                !(floating && spot === priceAt),
            )
            .map((spot) => (
              <button
                key={spot}
                type="button"
                onClick={() => commit(active, spot)}
                aria-label={`Move the ${active} to the ${spotLabel(spot)}`}
                className={cn(
                  "group absolute z-20 flex size-7 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  TILE_SPOT_CLASSES[spot],
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full border border-muted-foreground bg-background transition-transform duration-base ease-standard group-hover:scale-150 motion-reduce:transition-none"
                />
              </button>
            ))}
      </div>
    </div>
  );
}
