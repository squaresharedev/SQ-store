"use client";

import { AlertCircle } from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontBlock, StorefrontTheme } from "@/types/storefront";
import { ProductTileContent } from "./ProductTileContent";
import { TextTileContent, type TextBlockPatch } from "./TextTileContent";

/**
 * The visual face of one grid block, independent of drag/sort plumbing:
 * dispatches to the text or product content, or the flagged "product removed"
 * state when a referenced product no longer exists (never a crash). Used by
 * the sortable tile AND the drag overlay, so the floating copy always matches.
 */
export function BlockFace({
  block,
  product,
  theme,
  editingText = false,
  onUpdateText,
  onDoneEditingText,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  /** Text editing is only wired on the live tile, never on the overlay. */
  editingText?: boolean;
  onUpdateText?: (patch: TextBlockPatch) => void;
  onDoneEditingText?: () => void;
}) {
  if (block.type === "text") {
    return (
      <TextTileContent
        block={block}
        theme={theme}
        editing={editingText}
        onUpdate={onUpdateText ?? (() => {})}
        onDoneEditing={onDoneEditingText ?? (() => {})}
      />
    );
  }
  if (product) {
    return <ProductTileContent product={product} theme={theme} />;
  }
  return (
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
  );
}
