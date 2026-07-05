"use client";

import { Pencil, X } from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontBlock, StorefrontTheme } from "@/types/storefront";
import { cn } from "@/lib/utils";
import { BlockFace } from "./BlockFace";

const TILE_CONTROL_CLASS =
  "inline-flex size-6 items-center justify-center rounded-none text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none";

/**
 * The surface of one storefront block inside the shared <Grid>: the product or
 * text face, plus (in editable mode) the edit-text and remove controls. For
 * text blocks the pencil SELECTS the block for editing in the side panel
 * (TextBlockEditor) — the styling controls no longer live in the tile. Reorder
 * and resize are the grid's own drag + corner handles. A product block whose
 * product no longer exists renders a flagged, removable tile — never a crash.
 */
export function BlockTile({
  block,
  product,
  theme,
  editable,
  isEditing,
  onToggleEdit,
  onRemove,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  editable: boolean;
  /** True when this block is the one being edited in the side panel. */
  isEditing: boolean;
  onToggleEdit: () => void;
  onRemove: () => void;
}) {
  // Include the text content so several text blocks stay distinguishable to
  // screen readers.
  const label =
    block.type === "product"
      ? (product?.title ?? "Removed product")
      : block.text.trim()
        ? `Text: ${block.text.trim().slice(0, 30)}`
        : "Text block";

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col",
        // Product blocks are bordered cards; text blocks are chrome-less text
        // sitting on the canvas, so the two never read as the same thing.
        block.type === "product"
          ? "border border-border bg-card"
          : "bg-transparent",
        // Inset ring so the "being edited" state reads clearly without being
        // clipped by the grid cell's overflow.
        isEditing && "ring-2 ring-inset ring-ring",
      )}
    >
      {/* Edit (text) + remove. Revealed on hover/focus for fine pointers (the
          grid cell is the `group`); always visible on coarse pointers. Reorder
          + resize live on the grid's own handles. */}
      {editable && (
        <div
          className={cn(
            "absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-sm border border-border bg-background/95 p-0.5",
            "transition-opacity duration-180 ease-in-out motion-reduce:transition-none",
            "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
            isEditing && "pointer-fine:opacity-100",
          )}
        >
          {block.type === "text" && (
            <button
              type="button"
              onClick={onToggleEdit}
              aria-label={isEditing ? "Stop editing text" : "Edit text"}
              aria-pressed={isEditing}
              className={cn(
                TILE_CONTROL_CLASS,
                isEditing && "bg-accent text-foreground",
              )}
            >
              <Pencil className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
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

      <BlockFace block={block} product={product} theme={theme} />
    </div>
  );
}
