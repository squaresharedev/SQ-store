"use client";

import { Pencil, X } from "lucide-react";
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
 * text, or shape face, plus (in editable mode) the select-pencil and remove
 * controls. The pencil SELECTS the block — its editor card opens in the
 * inspector panel; no styling controls live on the tile itself. Reorder and
 * resize are the grid's own drag + corner handles. A product block whose
 * product no longer exists renders a flagged, removable tile — never a crash.
 */
export function BlockTile({
  block,
  product,
  theme,
  editable,
  isEditing = false,
  onToggleEdit,
  onRemove,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  editable: boolean;
  /** True when this block is the one open in the inspector panel. */
  isEditing?: boolean;
  /** Edit-mode callbacks — only consulted when `editable` (static previews omit them). */
  onToggleEdit?: () => void;
  onRemove?: () => void;
}) {
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
    <div
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
      {/* Edit (text) + remove. Revealed on hover/focus for fine pointers (the
          grid cell is the `group`); always visible on coarse pointers. Reorder
          + resize live on the grid's own handles. */}
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
            onClick={onToggleEdit}
            aria-label={isEditing ? `Close ${label} settings` : `Edit ${label}`}
            aria-pressed={isEditing}
            className={cn(
              TILE_CONTROL_CLASS,
              isEditing && "bg-accent text-foreground",
            )}
          >
            <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
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
