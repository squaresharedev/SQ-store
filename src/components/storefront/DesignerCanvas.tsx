"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { LayoutGrid } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockKey,
  readingOrder,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock, GridPlacement } from "@/components/grid/gridConstants";
import { BlockTile } from "./BlockTile";
import { CarouselStrip } from "./CarouselStrip";
import { StorefrontMasthead } from "./StorefrontMasthead";
import { resolveBackgroundStyle } from "./background-presets";
import {
  FONT_CLASSES,
  gridGapStyle,
  scaledCornerRadius,
} from "./config-maps";
import type { CanvasViewport } from "./useCanvasViewport";

/** Accessible label for a block's drag/resize handles. */
function blockLabel(block: StorefrontBlock, product: Product | null): string {
  if (block.type === "product") return product?.title ?? "Removed product";
  if (block.type === "shape") return `${block.kind} shape`;
  const text = block.text.trim();
  return text ? `Text: ${text.slice(0, 30)}` : "Text block";
}

/**
 * The live preview + editing canvas: renders the current config through the
 * shared, presentation-agnostic <Grid> (components/grid). The grid owns the
 * square-cell layout, drag-to-reorder, and the corner resize handle; this
 * component only maps storefront blocks into grid blocks and renders each
 * block's face + select/remove controls. Preview device + block selection are
 * owned by StorefrontDesigner (the toolbar and inspector need them too). The
 * buyer-facing embed can later render the same <Grid> with `editable={false}`.
 */
/**
 * Cell size the DESIGN canvas renders at, in px. The editor shows the board
 * at its natural size and zooms, rather than squeezing cells to fit the
 * window — that way a 12-column storefront is still designed as 12 columns on
 * a laptop. The buyer-facing render stays fluid.
 */
const DESIGN_CELL_PX = 96;

/** The canvas frame's own padding + border (p-4 plus a 1px edge), which
 *  border-box sizing folds into the width we set. */
const DESIGN_FRAME_CHROME_PX = 16 * 2 + 2;

export const DesignerCanvas = memo(function DesignerCanvas({
  blocks,
  productsById,
  theme,
  header,
  previewMode,
  backgroundImageUrl = null,
  showGrid = true,
  viewport,
  onMoveBlock,
  onResizeBlock,
  onRemove,
  onEmptyCellClick,
  selectedKey,
  onSelectBlock,
}: {
  blocks: StorefrontBlock[];
  productsById: Map<string, Product>;
  theme: StorefrontTheme;
  /** Optional masthead (name + bio) rendered above the grid when shown. */
  header: StorefrontHeader;
  /** Desktop designs at natural size + zoom; mobile previews fluid, so the
   *  seller sees the real small-screen reflow. */
  previewMode: "desktop" | "mobile";
  /** Display URL for an image background (signed server-side, or a local
   *  object URL right after an upload). Null renders the neutral base. */
  backgroundImageUrl?: string | null;
  /** Draw the free cells (editor guide only, never for buyers). */
  showGrid?: boolean;
  /** Owns the live pan + zoom and writes them to the stage imperatively.
   *  Desktop preview only. */
  viewport?: CanvasViewport;
  /** All callbacks are keyed by blockKey(block). */
  onMoveBlock: (key: string, x: number, y: number) => void;
  onResizeBlock: (key: string, placement: GridPlacement) => void;
  onRemove: (key: string) => void;
  /** Clicking a free cell inserts there. */
  onEmptyCellClick: (x: number, y: number) => void;
  /** Key of the block currently open in the inspector panel, if any. */
  selectedKey: string | null;
  onSelectBlock: (key: string | null) => void;
}) {
  const productFor = useCallback(
    (block: StorefrontBlock): Product | null =>
      block.type === "product"
        ? (productsById.get(block.productId) ?? null)
        : null,
    [productsById],
  );

  // Tile callbacks that never change identity: the live handlers are read
  // through a ref, so memoised tiles are not invalidated every render.
  const handlers = useRef({ onSelectBlock, onRemove, selectedKey });
  useEffect(() => {
    handlers.current = { onSelectBlock, onRemove, selectedKey };
  });
  const toggleSelection = useCallback((key: string) => {
    const { selectedKey: current, onSelectBlock: select } = handlers.current;
    select(current === key ? null : key);
  }, []);
  const removeByKey = useCallback((key: string) => {
    handlers.current.onRemove(key);
  }, []);

  // Map storefront blocks -> generic grid blocks. Each carries its own
  // coordinates, so the array order means nothing.
  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(
    () =>
      blocks.map((block) => ({
        key: blockKey(block),
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        data: block,
      })),
    [blocks],
  );

  // Carousel mode has no coordinates: it reads the board top-to-bottom,
  // left-to-right and swaps neighbours in that sequence.
  function shiftInCarousel(key: string, direction: -1 | 1) {
    const ordered = readingOrder(blocks);
    const index = ordered.findIndex((block) => blockKey(block) === key);
    const neighbor = ordered[index + direction];
    if (index < 0 || !neighbor) return;
    const moved = ordered[index];
    onMoveBlock(key, neighbor.x, neighbor.y);
    onMoveBlock(blockKey(neighbor), moved.x, moved.y);
  }

  // The design canvas renders at its natural size and is scaled; the mobile
  // preview stays fluid so the seller sees the real reflow.
  const isDesign = previewMode === "desktop";
  const naturalWidth = isDesign
    ? theme.columns * DESIGN_CELL_PX +
      (theme.columns - 1) * theme.gridGap +
      DESIGN_FRAME_CHROME_PX
    : undefined;

  const canvas = (
    <div
      className={cn(
        "rounded-md border border-border p-4",
        FONT_CLASSES[theme.font],
      )}
      // Schema-constrained: hex is re-gated by the strict regex, the gap is
      // a bounded integer. gridGapStyle sets the --grid-gap token the
      // .ss-grid rule (and the carousel strip) inherit.
      style={{
        ...resolveBackgroundStyle(theme.background, backgroundImageUrl),
        ...gridGapStyle(theme.gridGap),
      }}
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
              Add products, text, or shapes from the toolbar below to start
              arranging your storefront.
            </p>
          </div>
        ) : theme.displayMode === "carousel" ? (
          <>
            <CarouselStrip
              blocks={blocks}
              getProduct={productFor}
              theme={theme}
              editable
              editingKey={selectedKey}
              onSelect={onSelectBlock}
              onRemove={onRemove}
              onMove={shiftInCarousel}
            />
            <p className="mt-2 font-inter text-xs text-muted-foreground">
              Buyers swipe through this row, or tap the arrows at its edges. Use
              the arrows on a tile to reorder; placement applies in grid mode.
            </p>
          </>
        ) : (
          <Grid
            editable
            showEmptyCells={showGrid}
            blocks={gridBlocks}
            ariaLabel="Storefront canvas"
            columns={theme.columns}
            rows={theme.rows}
            // Corner roundness drives the cell clip (style beats the grid's
            // default rounded-sm class); tiles inherit it, no clip of their
            // own. Scaled per tile size so big tiles round like small ones.
            cellStyle={(placement) => ({
              borderRadius: scaledCornerRadius(theme.cornerRadius, placement),
            })}
            getBlockLabel={(gridBlock) =>
              blockLabel(gridBlock.data, productFor(gridBlock.data))
            }
            onMove={onMoveBlock}
            onResize={onResizeBlock}
            onEmptyCellClick={onEmptyCellClick}
            renderBlock={(gridBlock, state) => (
              <BlockTile
                blockKey={gridBlock.key}
                block={gridBlock.data}
                product={productFor(gridBlock.data)}
                theme={theme}
                editable={state.editable}
                isEditing={selectedKey === gridBlock.key}
                // Stable across renders, so a memoised tile only re-renders
                // when its OWN data or selection changes.
                onToggleEdit={toggleSelection}
                onRemove={removeByKey}
              />
            )}
          />
        )}
    </div>
  );

  // Mobile preview: a phone-width column, fluid, so the grid reflows exactly
  // as it will on a real device.
  if (!isDesign) {
    return <div className="mx-auto w-full max-w-sm">{canvas}</div>;
  }

  // Design view: the board floats on an endless workspace at its natural
  // size. The transform is NOT rendered here — the viewport writes it
  // straight to this element every frame (see useCanvasViewport), so panning
  // and zooming never re-render the canvas.
  return (
    <div
      ref={viewport?.registerStage}
      data-canvas-stage=""
      style={{
        width: naturalWidth,
        transformOrigin: "0 0",
        // Promote the stage to its own compositor layer up front, so a pan is
        // a GPU transform rather than a repaint of every tile.
        willChange: "transform",
      }}
      className="absolute left-0 top-0"
    >
      {canvas}
    </div>
  );
});
