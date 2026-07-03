"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, X } from "lucide-react";
import type { Product } from "@/types/product";
import {
  BLOCK_SIZES,
  blockKey,
  type BlockSize,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { RADIUS_CLASSES, SIZE_CLASSES, SIZE_LABELS } from "./config-maps";
import { BlockFace } from "./BlockFace";
import type { TextBlockPatch } from "./TextTileContent";

const TILE_CONTROL_CLASS =
  "inline-flex size-6 items-center justify-center rounded-none text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none";

/**
 * Sortable shell for one grid block: drag handle, size buttons, remove (and
 * an edit toggle for text blocks), dispatching to the product or text face.
 * A product block whose product no longer exists renders a flagged tile the
 * seller can remove (the save action drops it server-side too) — never a
 * crash.
 */
export function BlockTile({
  block,
  product,
  theme,
  onSizeChange,
  onRemove,
  onUpdateText,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  onSizeChange: (size: BlockSize) => void;
  onRemove: () => void;
  onUpdateText: (patch: TextBlockPatch) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: blockKey(block) });
  const [editingText, setEditingText] = useState(false);

  // Split the sortable listeners: the whole tile is a pointer drag surface
  // (like the source grid's cards) — except while editing text, so textarea
  // selection drags stay selection drags. Keyboard drag stays on the handle
  // button (the focusable control); pointer events from the handle bubble to
  // the tile, so the handle is never wired directly (no double activation).
  // dnd-kit types listener-map values as bare `Function`; narrow to React's
  // handler types at the split.
  const pointerDragProps =
    !editingText && listeners?.onPointerDown
      ? {
          onPointerDown:
            listeners.onPointerDown as React.PointerEventHandler<HTMLLIElement>,
        }
      : {};
  const keyboardDragProps = listeners?.onKeyDown
    ? {
        onKeyDown:
          listeners.onKeyDown as React.KeyboardEventHandler<HTMLButtonElement>,
      }
    : {};

  // Include the text content so several text blocks stay distinguishable to
  // screen readers.
  const label =
    block.type === "product"
      ? (product?.title ?? "Removed product")
      : block.text.trim()
        ? `Text: ${block.text.trim().slice(0, 30)}`
        : "Text block";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...pointerDragProps}
      className={cn(
        "group relative flex flex-col overflow-hidden border border-border bg-card",
        SIZE_CLASSES[block.size],
        RADIUS_CLASSES[theme.radius],
        !editingText && "cursor-grab",
        // The DragOverlay carries the floating copy; the in-place tile stays
        // as a dimmed placeholder so the drop slot reads clearly.
        isDragging && "z-10 cursor-grabbing opacity-40",
      )}
    >
      {/* Tile controls: drag handle, size choices, edit (text), remove.
          Revealed on hover/focus for mouse users to keep the preview clean;
          always visible on coarse pointers, which have no hover. */}
      <div
        className={cn(
          "absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-sm border border-border bg-background/95 p-0.5",
          "transition-opacity duration-180 ease-in-out motion-reduce:transition-none",
          "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
          editingText && "pointer-fine:opacity-100",
        )}
      >
        <button
          type="button"
          aria-label={`Reorder ${label}`}
          className={cn(TILE_CONTROL_CLASS, "cursor-grab active:cursor-grabbing")}
          {...attributes}
          {...keyboardDragProps}
        >
          <GripVertical className="size-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
        {BLOCK_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => onSizeChange(size)}
            aria-label={`${SIZE_LABELS[size]} for ${label}`}
            aria-pressed={block.size === size}
            className={cn(
              TILE_CONTROL_CLASS,
              "font-inter text-xs",
              block.size === size && "bg-accent text-foreground",
            )}
          >
            {size}
          </button>
        ))}
        {block.type === "text" && (
          <button
            type="button"
            onClick={() => setEditingText((editing) => !editing)}
            aria-label={editingText ? "Stop editing text" : "Edit text"}
            aria-pressed={editingText}
            className={cn(
              TILE_CONTROL_CLASS,
              editingText && "bg-accent text-foreground",
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

      <BlockFace
        block={block}
        product={product}
        theme={theme}
        editingText={editingText}
        onUpdateText={onUpdateText}
        onDoneEditingText={() => setEditingText(false)}
      />
    </li>
  );
}
