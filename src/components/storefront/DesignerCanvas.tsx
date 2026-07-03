"use client";

import { useId, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { LayoutGrid } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockKey,
  type BlockSize,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { BlockFace } from "./BlockFace";
import { BlockTile } from "./BlockTile";
import type { TextBlockPatch } from "./TextTileContent";
import { resolveBackgroundStyle } from "./background-presets";
import { FONT_CLASSES, RADIUS_CLASSES } from "./config-maps";

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

  // The block being dragged, rendered as a floating copy in the DragOverlay
  // while the in-place tile dims to mark the drop slot.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeBlock = useMemo(
    () => blocks.find((block) => blockKey(block) === activeKey) ?? null,
    [blocks, activeKey],
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveKey(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveKey(null);
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
      // Schema-constrained: preset keys resolve through the fixed allowlist
      // map, hex is re-gated by the strict regex. Anything else styles nothing.
      style={resolveBackgroundStyle(theme.background)}
    >
      {blocks.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-sm border border-dashed border-border bg-background/60 p-6 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border bg-background shadow-xs">
            <LayoutGrid
              className="size-5 text-muted-foreground"
              strokeWidth={2}
              aria-hidden="true"
            />
          </div>
          <p className="text-sm font-medium text-foreground">
            Your grid is empty
          </p>
          <p className="mt-1 max-w-xs font-inter text-sm text-muted-foreground">
            Add products or a text block from the panel to start arranging
            your storefront.
          </p>
        </div>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveKey(null)}
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

          {/* Floating copy that follows the cursor while dragging (ported
              from the SquareShare grid) — the strongest cue for what is
              being moved and where it will land. */}
          <DragOverlay dropAnimation={null}>
            {activeBlock ? (
              <div
                // DragOverlay sizes itself to the dragged tile's rect, so no
                // grid span classes are needed here.
                className={cn(
                  "flex h-full w-full flex-col overflow-hidden border border-border bg-card shadow-lg ring-2 ring-ring/30",
                  RADIUS_CLASSES[theme.radius],
                  FONT_CLASSES[theme.font],
                )}
              >
                <BlockFace
                  block={activeBlock}
                  product={
                    activeBlock.type === "product"
                      ? (productsById.get(activeBlock.productId) ?? null)
                      : null
                  }
                  theme={theme}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
