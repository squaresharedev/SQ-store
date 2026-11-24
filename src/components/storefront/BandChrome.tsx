"use client";

import { useRef } from "react";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BAND_EXTENT_STYLE } from "@/lib/storefront/bands";
import type { StorefrontBand } from "@/types/storefront";

/** Pointer travel (px) before a press on the rail becomes a drag. The grid's
 *  own threshold, so a band and a tile answer a hand the same way. */
const DRAG_THRESHOLD = 4;

/**
 * Where the rail sits: just outside the board frame's right edge, level with
 * the band, so the controls never cover the seller's work. The frame's own
 * padding is the bleed the band paints across (DESIGNER_BAND_BLEED).
 */
const RAIL_STYLE = {
  top: BAND_EXTENT_STYLE.top,
  bottom: BAND_EXTENT_STYLE.bottom,
  left: "calc(100% + var(--sf-band-bleed, 0px) + 0.5rem)",
} as const;

/** The rail's look: the tile handles' chrome, standing upright. */
const RAIL_CLASS = cn(
  "pointer-events-auto absolute flex w-6 flex-col items-center justify-center rounded-sm border border-border bg-background text-muted-foreground shadow-xs",
  "cursor-grab touch-none select-none active:cursor-grabbing",
  "transition-colors duration-base ease-standard motion-reduce:transition-none hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

/**
 * A BAND'S CONTROLS ON THE CANVAS: a rail beside the board, level with the
 * band. Press it to edit the band; drag it up or down to move the band by
 * whole rows; drag its foot to change how many rows it covers. Arrows on the
 * focused rail do the same (Shift stretches). While the band is selected its
 * rows are outlined across the board.
 *
 * The drag is measured off the grid it sits in (a row is this layer's height
 * plus a gap, over the band's rows), so it tracks the hand at any zoom, and
 * it commits whenever the band crosses a row: the designer coalesces those
 * into one undo step per drag.
 */
export function BandChrome({
  band,
  selected,
  onSelect,
  onMove,
}: {
  band: StorefrontBand;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Where the band now runs; the designer holds it to the board. */
  onMove: (id: string, at: { y: number; h: number }) => void;
}) {
  const t = useTranslations("EditorLayout.panel.bandChrome");
  const railRef = useRef<HTMLButtonElement>(null);

  /** One row's pitch on screen, read off the layer this sits in. */
  function rowPitch(): number | null {
    const layer = railRef.current?.parentElement;
    const grid = layer?.parentElement;
    if (!layer || !grid) return null;
    const rect = layer.getBoundingClientRect();
    const scale = layer.offsetHeight > 0 ? rect.height / layer.offsetHeight : 1;
    const gap = (Number.parseFloat(getComputedStyle(grid).rowGap) || 0) * scale;
    return (rect.height + gap) / band.h;
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, mode: "move" | "stretch") {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pitch = rowPitch();
    if (!pitch) return;
    const startY = event.clientY;
    const origin = { y: band.y, h: band.h };
    let dragging = false;
    let lastRows = 0;
    const onPointerMove = (move: PointerEvent) => {
      const dy = move.clientY - startY;
      if (!dragging && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
      const rows = Math.round(dy / pitch);
      if (rows === lastRows) return;
      lastRows = rows;
      onMove(band.id, mode === "move" ? { y: origin.y + rows, h: origin.h } : { y: origin.y, h: origin.h + rows });
    };
    const finish = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (!dragging) onSelect(band.id);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    onMove(band.id, event.shiftKey ? { y: band.y, h: band.h + step } : { y: band.y + step, h: band.h });
  }

  return (
    <>
      {selected && (
        <div
          aria-hidden="true"
          data-band-selected={band.id}
          className="pointer-events-none absolute border-y-2 border-dashed border-ring"
          style={BAND_EXTENT_STYLE}
        />
      )}
      <button
        ref={railRef}
        type="button"
        data-band-rail={band.id}
        aria-pressed={selected}
        aria-label={t("rail", { from: band.y + 1, to: band.y + band.h })}
        onPointerDown={(event) => startDrag(event, "move")}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          // A keyboard press (Enter, Space) arrives as a click with no pointer.
          if (event.detail === 0) onSelect(band.id);
        }}
        className={cn(RAIL_CLASS, selected && "border-ring text-foreground")}
        style={RAIL_STYLE}
      >
        <GripVertical className="size-4" strokeWidth={2} aria-hidden="true" />
        <span
          role="presentation"
          title={t("stretch")}
          onPointerDown={(event) => startDrag(event, "stretch")}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize rounded-b-sm bg-border/60"
        />
      </button>
    </>
  );
}
