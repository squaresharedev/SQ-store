"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, GripVertical, Pencil, X } from "lucide-react";
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
import { ProductTileContent } from "./ProductTileContent";
import { TextTileContent, type TextBlockPatch } from "./TextTileContent";

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
      className={cn(
        "group relative flex flex-col overflow-hidden border border-border bg-card",
        SIZE_CLASSES[block.size],
        RADIUS_CLASSES[theme.radius],
        isDragging && "z-10 opacity-80 shadow-md",
      )}
    >
      {/* Tile controls: drag handle, size choices, edit (text), remove. */}
      <div className="absolute right-1 top-1 z-20 flex items-center gap-0.5 rounded-sm border border-border bg-background/95 p-0.5">
        <button
          type="button"
          aria-label={`Reorder ${label}`}
          className={cn(TILE_CONTROL_CLASS, "cursor-grab active:cursor-grabbing")}
          {...attributes}
          {...listeners}
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

      {block.type === "text" ? (
        <TextTileContent
          block={block}
          theme={theme}
          editing={editingText}
          onUpdate={onUpdateText}
          onDoneEditing={() => setEditingText(false)}
        />
      ) : product ? (
        <ProductTileContent product={product} theme={theme} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center">
          <AlertCircle
            className="size-5 text-destructive"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="font-inter text-xs text-muted-foreground">
            Product removed. Delete this block.
          </span>
        </div>
      )}
    </li>
  );
}
