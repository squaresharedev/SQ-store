"use client";

import { useId } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import type { Product } from "@/types/product";
import {
  blockKey,
  type BlockSize,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import { BlockTile } from "./BlockTile";
import type { TextBlockPatch } from "./TextTileContent";
import { FONT_CLASSES } from "./config-maps";

/**
 * The live preview: renders the current config as the bento grid the buyer's
 * embed will eventually show, and doubles as the editing canvas (drag to
 * reorder). Blocks flow in array order on a fixed 4-column grid (2 under sm).
 */
export function DesignerCanvas({
  blocks,
  productsById,
  theme,
  onReorder,
  onSizeChange,
  onRemove,
  onUpdateText,
}: {
  blocks: StorefrontBlock[];
  productsById: Map<string, Product>;
  theme: StorefrontTheme;
  /** All callbacks are keyed by blockKey(block). */
  onReorder: (activeKey: string, overKey: string) => void;
  onSizeChange: (key: string, size: BlockSize) => void;
  onRemove: (key: string) => void;
  onUpdateText: (key: string, patch: TextBlockPatch) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Stable id keeps dnd-kit's generated aria ids (DndDescribedBy-*) identical
  // between server and client render — without it hydration mismatches.
  const dndId = useId();

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  }

  return (
    <div
      className={cn(
        "rounded-md border border-border p-4",
        FONT_CLASSES[theme.font],
      )}
      // Background is schema-constrained hex; re-gate before styling anyway.
      style={
        isStrictHexColor(theme.background)
          ? { backgroundColor: theme.background }
          : undefined
      }
    >
      {blocks.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-sm border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            Your grid is empty
          </p>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Add products from the panel to start arranging your storefront.
          </p>
        </div>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={blocks.map(blockKey)}
            strategy={rectSortingStrategy}
          >
            <ul
              aria-label="Storefront grid"
              className="grid list-none grid-cols-2 auto-rows-(--spacing-tile-row) gap-2 sm:grid-cols-4"
            >
              {blocks.map((block) => {
                const key = blockKey(block);
                return (
                  <BlockTile
                    key={key}
                    block={block}
                    product={
                      block.type === "product"
                        ? (productsById.get(block.productId) ?? null)
                        : null
                    }
                    theme={theme}
                    onSizeChange={(size) => onSizeChange(key, size)}
                    onRemove={() => onRemove(key)}
                    onUpdateText={(patch) => onUpdateText(key, patch)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
