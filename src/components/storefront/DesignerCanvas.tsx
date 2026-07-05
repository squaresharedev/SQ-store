"use client";

import { useCallback, useMemo, useState } from "react";
import { LayoutGrid, Monitor, Smartphone } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockKey,
  type BlockSize,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock } from "@/components/grid/gridConstants";
import { BlockTile } from "./BlockTile";
import { CarouselStrip } from "./CarouselStrip";
import { StorefrontMasthead } from "./StorefrontMasthead";
import { resolveBackgroundStyle } from "./background-presets";
import { DENSITY_CLASSES, FONT_CLASSES, RADIUS_CLASSES } from "./config-maps";

/** Accessible label for a block's drag/resize handles. */
function blockLabel(block: StorefrontBlock, product: Product | null): string {
  if (block.type === "product") return product?.title ?? "Removed product";
  const text = block.text.trim();
  return text ? `Text: ${text.slice(0, 30)}` : "Text block";
}

/**
 * The live preview + editing canvas: renders the current config through the
 * shared, presentation-agnostic <Grid> (components/grid). The grid owns the
 * square-cell layout, drag-to-reorder, and the corner resize handle; this
 * component only maps storefront blocks into grid blocks and renders each
 * block's face + edit/remove controls. The buyer-facing embed can later render
 * the same <Grid> with `editable={false}`.
 */
export function DesignerCanvas({
  blocks,
  productsById,
  theme,
  header,
  onReorder,
  onSizeChange,
  onRemove,
  onToggleSoldOut,
  editingKey,
  onEditText,
}: {
  blocks: StorefrontBlock[];
  productsById: Map<string, Product>;
  theme: StorefrontTheme;
  /** Optional masthead (name + bio) rendered above the grid when shown. */
  header: StorefrontHeader;
  /** All callbacks are keyed by blockKey(block). */
  onReorder: (activeKey: string, overKey: string) => void;
  onSizeChange: (key: string, size: BlockSize) => void;
  onRemove: (key: string) => void;
  onToggleSoldOut: (key: string) => void;
  /** Key of the text block currently being edited in the side panel, if any. */
  editingKey: string | null;
  onEditText: (key: string | null) => void;
}) {
  // Mobile-preview toggle — preview-only, NOT persisted.
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");

  const productFor = useCallback(
    (block: StorefrontBlock): Product | null =>
      block.type === "product"
        ? (productsById.get(block.productId) ?? null)
        : null,
    [productsById],
  );

  // Map storefront blocks -> generic grid blocks. `order` is the ARRAY INDEX:
  // StorefrontDesigner keeps blocks in visual order and only writes the `order`
  // field on save, so the index is the authoritative current order.
  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(
    () =>
      blocks.map((block, index) => ({
        key: blockKey(block),
        size: block.size,
        order: index,
        data: block,
      })),
    [blocks],
  );

  // Carousel reorder: move one slot by handing the neighbor's key to the same
  // onReorder the grid's drag uses — one reorder path for both display modes.
  function moveBlock(key: string, direction: -1 | 1) {
    const index = blocks.findIndex((block) => blockKey(block) === key);
    const neighbor = blocks[index + direction];
    if (index < 0 || !neighbor) return;
    onReorder(key, blockKey(neighbor));
  }

  // Shared toggle button style — SHARP buttons (rounded-none), brand convention.
  const toggleBase =
    "inline-flex size-7 items-center justify-center rounded-none transition-colors duration-180 ease-in-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const toggleActive = "bg-primary text-primary-foreground";
  const toggleIdle =
    "border border-border text-muted-foreground hover:bg-accent";

  return (
    <div className="flex flex-col gap-2">
      {/* Mobile/desktop preview toggle — right-aligned, preview only. */}
      <div className="flex justify-end gap-1">
        <button
          type="button"
          aria-label="Desktop preview"
          aria-pressed={previewMode === "desktop"}
          className={cn(toggleBase, previewMode === "desktop" ? toggleActive : toggleIdle)}
          onClick={() => setPreviewMode("desktop")}
        >
          <Monitor className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Mobile preview"
          aria-pressed={previewMode === "mobile"}
          className={cn(toggleBase, previewMode === "mobile" ? toggleActive : toggleIdle)}
          onClick={() => setPreviewMode("mobile")}
        >
          <Smartphone className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Canvas frame — narrows to a phone-width column in mobile preview.
          That alone IS the mobile render: the grid's container query keys off
          its own width, so columns, wrapping, and square-cell math all reflow
          exactly as they will on a real phone. */}
      <div className={cn(previewMode === "mobile" && "mx-auto w-full max-w-sm")}>
        <div
          className={cn(
            "rounded-md border border-border p-4",
            FONT_CLASSES[theme.font],
            // Density picks the --grid-gap override the .ss-grid rule inherits.
            DENSITY_CLASSES[theme.density],
          )}
          // Schema-constrained: preset keys resolve through the fixed allowlist
          // map, hex is re-gated by the strict regex. Anything else styles nothing.
          style={resolveBackgroundStyle(theme.background)}
        >
          <StorefrontMasthead header={header} theme={theme} />

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
          ) : theme.displayMode === "carousel" ? (
            <>
              <CarouselStrip
                blocks={blocks}
                getProduct={productFor}
                theme={theme}
                editable
                editingKey={editingKey}
                onEditText={onEditText}
                onRemove={onRemove}
                onToggleSoldOut={onToggleSoldOut}
                onMove={moveBlock}
              />
              <p className="mt-2 font-inter text-xs text-muted-foreground">
                Buyers swipe through this row. Use the arrows to reorder; block
                sizes apply in grid mode.
              </p>
            </>
          ) : (
            <Grid
              editable
              showEmptyCells
              blocks={gridBlocks}
              ariaLabel="Storefront grid"
              // Finer 6-column grid (3 in narrow containers) → more cells,
              // more shape freedom. The mobile preview needs no override: the
              // narrowed frame trips the grid's own container query.
              columns={6}
              mobileColumns={3}
              // Theme radius drives the cell clip (overrides the grid's rounded-sm).
              // Product-tile shape clip is handled inside ProductTileContent.
              cellClassName={RADIUS_CLASSES[theme.radius]}
              getBlockLabel={(gridBlock) =>
                blockLabel(gridBlock.data, productFor(gridBlock.data))
              }
              onReorder={onReorder}
              onResize={onSizeChange}
              renderBlock={(gridBlock, state) => (
                <BlockTile
                  block={gridBlock.data}
                  product={productFor(gridBlock.data)}
                  theme={theme}
                  editable={state.editable}
                  isEditing={editingKey === gridBlock.key}
                  onToggleEdit={() =>
                    onEditText(editingKey === gridBlock.key ? null : gridBlock.key)
                  }
                  onRemove={() => onRemove(gridBlock.key)}
                  onToggleSoldOut={() => onToggleSoldOut(gridBlock.key)}
                />
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
