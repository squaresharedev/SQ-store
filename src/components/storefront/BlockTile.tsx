"use client";

import { memo, useRef } from "react";
import { X } from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontBlock, StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { BlockFace } from "./BlockFace";

/** Small square control button used in tile chrome (also by CarouselStrip's
 *  move buttons, so all tile controls look identical). */
export const TILE_CONTROL_CLASS =
  "inline-flex size-6 items-center justify-center rounded-none text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40";

/** The floating chip that holds tile controls, revealed on hover/focus for
 *  fine pointers (the surrounding grid/strip cell is the `group`). */
export const TILE_CONTROL_CHIP_CLASS = cn(
  "absolute z-20 flex items-center gap-0.5 rounded-sm border border-border bg-background/95 p-0.5",
  "transition-opacity duration-base ease-standard motion-reduce:transition-none",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
);

/**
 * The surface of one storefront block inside the shared <Grid>: the product,
 * text, or shape face, plus (in editable mode) a remove control. CLICKING the
 * tile selects it: its editor card opens in the inspector panel (Enter/Space
 * do the same for keyboard users); no styling controls live on the tile
 * itself. Reorder is the grid's whole-surface drag, resize its corner handle.
 * A product block whose product no longer exists renders a flagged, removable
 * tile, never a crash.
 */
/**
 * MEMOISED, and the props are designed for it: the callbacks take the block's
 * key so callers can pass ONE stable function rather than a fresh closure per
 * tile. Without this, an unrelated edit (typing the storefront name) re-rendered
 * every tile on the board — measured at 67ms per keystroke on a full canvas.
 */
export const BlockTile = memo(function BlockTile({
  blockKey,
  block,
  product,
  theme,
  editable,
  isEditing = false,
  onToggleEdit,
  onRemove,
}: {
  /** Identity handed back to the callbacks, so they can stay stable. */
  blockKey: string;
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  editable: boolean;
  /** True when this block is the one open in the inspector panel. */
  isEditing?: boolean;
  /** Edit-mode callbacks — only consulted when `editable` (static previews omit them). */
  onToggleEdit?: (key: string) => void;
  onRemove?: (key: string) => void;
}) {
  // Include the text content so several text blocks stay distinguishable to
  // screen readers.
  const label =
    block.type === "product"
      ? (product?.title ?? "Removed product")
      : block.type === "shape"
        ? `${block.kind} shape`
        : block.text.trim()
          ? `Text: ${block.text.trim().slice(0, 30)}`
          : "Text block";

  const selectable = editable && onToggleEdit !== undefined;

  // Where the pointer went down, so a whole-surface DRAG that ends over the
  // tile is not mistaken for a select click (the grid starts drags after 4px
  // of travel; a click that traveled further was a drag).
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Presses on the tile's own controls (remove, carousel arrows) keep their
    // own click behavior.
    if ((event.target as HTMLElement).closest("button")) return;
    const down = pointerDownAt.current;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) {
      return;
    }
    onToggleEdit?.(blockKey);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Only keys on the tile itself; keys inside inner buttons keep their own.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleEdit?.(blockKey);
    }
  }

  return (
    <div
      // The tile itself is the select control: click (or Enter/Space) opens
      // the block's editor card in the inspector panel.
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-label={
        selectable
          ? isEditing
            ? `Close ${label} settings`
            : `Edit ${label}`
          : undefined
      }
      aria-pressed={selectable ? isEditing : undefined}
      onPointerDown={
        selectable
          ? (event) => {
              pointerDownAt.current = { x: event.clientX, y: event.clientY };
            }
          : undefined
      }
      onClick={selectable ? handleClick : undefined}
      onKeyDown={selectable ? handleKeyDown : undefined}
      className={cn(
        "relative h-full w-full",
        // The tile fills its cell exactly, so inheriting the cell's corner
        // radius makes the card border and the selection ring CURVE with the
        // roundness setting instead of being sliced square by the cell's clip.
        // Inherited (not passed in) so the grid, the carousel strip, and the
        // drag overlay all stay in sync for free.
        "rounded-[inherit]",
        // Product blocks are bordered cards; text and shape blocks sit
        // chrome-less on the canvas, so the kinds never read as the same thing.
        block.type === "product"
          ? "border border-border bg-card"
          : "bg-transparent",
        // Inset ring so the "being edited" state reads clearly without being
        // clipped by the grid cell's overflow.
        isEditing && "ring-2 ring-inset ring-ring",
        selectable &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // In the designer, a block buyers won't see (sold out + hideSoldOut)
        // stays visible but dimmed so the seller can still manage it.
        editable &&
          block.type === "product" &&
          block.soldOut &&
          theme.hideSoldOut &&
          "opacity-50",
      )}
    >
      {/* Remove control. Revealed on hover/focus for fine pointers (the grid
          cell is the `group`); always visible on coarse pointers. */}
      {editable && onRemove && (
        <div
          className={cn(
            TILE_CONTROL_CHIP_CLASS,
            "right-1 top-1",
            isEditing && "pointer-fine:opacity-100",
          )}
        >
          <button
            type="button"
            onClick={() => onRemove(blockKey)}
            aria-label={`Remove ${label} from grid`}
            className={cn(TILE_CONTROL_CLASS, "hover:text-destructive")}
          >
            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* The face clips ITSELF to the corner radius (the cell deliberately
          no longer clips), so the controls above stay visible in the square
          corner of a circle/pill tile. contain:paint keeps the per-cell paint
          isolation the grid used to provide. */}
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit] [contain:paint]">
        <BlockFace block={block} product={product} theme={theme} />
      </div>
    </div>
  );
});
