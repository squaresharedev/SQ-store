"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockKey,
  type StorefrontBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  BlockTile,
  TILE_CONTROL_CHIP_CLASS,
  TILE_CONTROL_CLASS,
} from "./BlockTile";
import { RADIUS_CLASSES } from "./config-maps";

/**
 * The `carousel` display mode's renderer: a horizontal scroll-snap strip of
 * uniform square tiles, shared by the designer canvas (editable — arrows
 * reorder; block SIZES only apply in grid mode) and the static card preview
 * (`compact`). The gap tracks the same `--grid-gap` custom property as the
 * grid, so the density setting applies to both modes.
 */
export function CarouselStrip({
  blocks,
  getProduct,
  theme,
  editable = false,
  editingKey = null,
  onSelect,
  onRemove,
  onMove,
  compact = false,
}: {
  /** In visual order; the caller applies any hide-sold-out filtering. */
  blocks: StorefrontBlock[];
  getProduct: (block: StorefrontBlock) => Product | null;
  theme: StorefrontTheme;
  editable?: boolean;
  /** Key of the block open in the inspector panel (editable mode only). */
  editingKey?: string | null;
  onSelect?: (key: string | null) => void;
  onRemove?: (key: string) => void;
  /** Move a block one slot left (-1) or right (1). */
  onMove?: (key: string, direction: -1 | 1) => void;
  compact?: boolean;
}) {
  return (
    <ul
      aria-label="Storefront carousel"
      className="m-0 flex list-none snap-x snap-mandatory overflow-x-auto p-0"
      // The shared bento gap token (density override included) — code-defined.
      style={{ gap: "var(--grid-gap)" }}
    >
      {blocks.map((block, index) => {
        const key = blockKey(block);
        return (
          <li
            key={key}
            className={cn(
              "group relative aspect-square shrink-0 snap-start overflow-hidden",
              compact ? "w-24" : "w-40 sm:w-48",
              RADIUS_CLASSES[theme.radius],
            )}
          >
            <BlockTile
              block={block}
              product={getProduct(block)}
              theme={theme}
              editable={editable}
              isEditing={editingKey === key}
              onToggleEdit={
                onSelect
                  ? () => onSelect(editingKey === key ? null : key)
                  : undefined
              }
              onRemove={onRemove ? () => onRemove(key) : undefined}
            />

            {/* Reorder arrows (the grid's drag handle has no meaning here). */}
            {editable && onMove && (
              <div className={cn(TILE_CONTROL_CHIP_CLASS, "left-1 top-1")}>
                <button
                  type="button"
                  onClick={() => onMove(key, -1)}
                  disabled={index === 0}
                  aria-label="Move block left"
                  className={TILE_CONTROL_CLASS}
                >
                  <ChevronLeft
                    className="size-3.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(key, 1)}
                  disabled={index === blocks.length - 1}
                  aria-label="Move block right"
                  className={TILE_CONTROL_CLASS}
                >
                  <ChevronRight
                    className="size-3.5"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
