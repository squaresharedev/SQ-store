"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontBlock, StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { BlockFace } from "./BlockFace";

/** Small square control button used in tile chrome (also by CarouselStrip's
 *  move buttons, so all tile controls look identical). */
export const TILE_CONTROL_CLASS =
  "inline-flex size-6 items-center justify-center rounded-none text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40";

/** The floating chip that holds tile controls, revealed on hover/focus for
 *  fine pointers (the surrounding grid/strip cell is the `group`). */
export const TILE_CONTROL_CHIP_CLASS = cn(
  "absolute z-20 flex items-center gap-0.5 rounded-sm border border-border bg-background/95 p-0.5",
  "transition-opacity duration-180 ease-in-out motion-reduce:transition-none",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
);

/**
 * The surface of one storefront block inside the shared <Grid>: the product,
 * text, or shape face, plus (in editable mode) the remove control. CLICKING
 * THE TILE selects it — its editor card opens in the inspector panel; there is
 * no separate edit button. Keyboard users get the same via a focusable overlay
 * (see below). Reorder and resize are the grid's own drag + corner handles.
 * A product block whose product no longer exists renders a flagged, removable
 * tile — never a crash.
 */
export function BlockTile({
  block,
  product,
  theme,
  editable,
  isEditing = false,
  isDragging = false,
  onSelect,
  onRemove,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  editable: boolean;
  /** True when this block is the one open in the inspector panel. */
  isEditing?: boolean;
  /** True while the grid is dragging this block (suppresses the click). */
  isDragging?: boolean;
  /** Edit-mode callbacks — only consulted when `editable` (static previews omit them). */
  onSelect?: () => void;
  onRemove?: () => void;
}) {
  // A drag can end with the browser still firing a click on the dragged tile;
  // without this guard every reorder would also open the inspector. Armed by
  // the isDragging effect, cleared at the START of each pointer interaction —
  // clearing on pointerdown (not on consumption) matters because a drag that
  // ends over a DIFFERENT element fires no click at all, and a consumed-flag
  // scheme would swallow the next legitimate click instead.
  const wasDragged = useRef(false);
  useEffect(() => {
    if (isDragging) wasDragged.current = true;
  }, [isDragging]);

  function handleTilePointerDown() {
    wasDragged.current = false;
  }

  function handleTileClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!editable || !onSelect) return;
    // Ignore clicks on real controls inside the tile (remove, grid handles).
    if ((event.target as HTMLElement).closest("button")) return;
    if (wasDragged.current) return;
    onSelect();
  }

  // Include the text content so several text blocks stay distinguishable to
  // screen readers.
  const label =
    block.type === "product"
      ? (product?.title ?? "Removed product")
      : block.type === "shape"
        ? block.kind === "spacer"
          ? "Spacer"
          : `${block.kind} shape`
        : block.text.trim()
          ? `Text: ${block.text.trim().slice(0, 30)}`
          : "Text block";

  return (
    // Click-to-select is a pointer convenience layered on the tile; the
    // accessible path is the overlay button below, so the div itself
    // deliberately carries no role.
    <div
      onClick={handleTileClick}
      onPointerDown={handleTilePointerDown}
      className={cn(
        "relative flex h-full w-full flex-col",
        // Product blocks are bordered cards; text and shape blocks sit
        // chrome-less on the canvas, so the kinds never read as the same thing.
        block.type === "product"
          ? "border border-border bg-card"
          : "bg-transparent",
        // Inset ring so the "being edited" state reads clearly without being
        // clipped by the grid cell's overflow.
        isEditing && "ring-2 ring-inset ring-ring",
        // In the designer, a block buyers won't see (sold out + hideSoldOut)
        // stays visible but dimmed so the seller can still manage it.
        editable &&
          block.type === "product" &&
          block.soldOut &&
          theme.hideSoldOut &&
          "opacity-50",
      )}
    >
      {/* Keyboard path for "open the editor": an invisible, focusable overlay.
          pointer-events-none keeps every pointer interaction (click-select,
          whole-tile drag) on the elements beneath; keyboard activation still
          fires because the events target the FOCUSED element. Paints a ring
          over the tile only while focused. */}
      {editable && onSelect && (
        <button
          type="button"
          onClick={onSelect}
          aria-label={`Edit ${label}`}
          aria-pressed={isEditing}
          tabIndex={0}
          className="pointer-events-none absolute inset-0 z-10 opacity-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        />
      )}

      {/* Remove control. Revealed on hover/focus for fine pointers (the grid
          cell is the `group`); always visible on coarse pointers. Reorder +
          resize live on the grid's own handles. */}
      {editable && (
        <div
          className={cn(
            TILE_CONTROL_CHIP_CLASS,
            "right-1 top-1",
            isEditing && "pointer-fine:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label} from grid`}
            className={cn(TILE_CONTROL_CLASS, "hover:text-destructive")}
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      <BlockFace
        block={block}
        product={product}
        theme={theme}
        editable={editable}
      />
    </div>
  );
}
