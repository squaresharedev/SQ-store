"use client";

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { LayoutGrid } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockCornerRadius,
  blockKey,
  readingOrder,
  type HeaderLine,
  type ImagePlacement,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextSpan,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  customFontVars,
  fontPresentation,
} from "@/lib/theme/storefront-fonts";
import { Grid } from "@/components/grid/Grid";
import type { GridBlock, GridPlacement } from "@/components/grid/gridConstants";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";
import { BlockTile } from "./BlockTile";
import { CarouselStrip } from "./CarouselStrip";
import { CustomFontFace } from "./CustomFontFace";
import { StorefrontMasthead } from "./StorefrontMasthead";
import { resolveBackgroundStyle } from "./background-presets";
import { gridGapStyle, scaledCornerRadius } from "./config-maps";
import type { CanvasViewport } from "./useCanvasViewport";

/** Accessible label for a block's drag/resize handles. */
function blockLabel(block: StorefrontBlock, product: Product | null): string {
  if (block.type === "product") return product?.title ?? "Removed product";
  if (block.type === "shape") return `${block.kind} shape`;
  if (block.type === "image") {
    const alt = block.alt.trim();
    return alt ? `Image: ${alt.slice(0, 30)}` : "Image element";
  }
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
  customFontUrl = null,
  elementUrls,
  showGrid = true,
  viewport,
  onMoveBlock,
  onResizeBlock,
  onRemove,
  onEmptyCellClick,
  selectedKeys,
  onSelectBlock,
  onSelectMany,
  activeHeaderLine = null,
  onSelectHeaderLine,
  framingKey = null,
  onFrameBlock,
  onFramePlacement,
  onFrameExit,
  typingKey = null,
  typingSelectAll = false,
  onTypeStart,
  onTextChange,
  onToggleBlockFormat,
  onTextRangeChange,
  onTypeEnd,
  disableMarquee = false,
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
  /** Display URL for the theme's uploaded font, signed the same way. Null
   *  leaves anything set to the custom font on the inherited face. */
  customFontUrl?: string | null;
  /** Display URL per image block, keyed by blockKey — signed server-side, or a
   *  local object URL for an element added in this session. A missing entry
   *  renders the element's placeholder rather than a broken image. */
  elementUrls?: Record<string, string>;
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
  /** Keys of the blocks currently open in the inspector panel. */
  selectedKeys: readonly string[];
  /** Click selection; `additive` = shift-click (add/remove, not replace). */
  onSelectBlock: (key: string | null, additive?: boolean) => void;
  /** Replace the whole selection (the marquee's channel). */
  onSelectMany: (keys: string[]) => void;
  /** The masthead line the style panel is on, if any. */
  activeHeaderLine?: HeaderLine | null;
  /** Clicking a masthead line aims the left-hand panel at it. Omitted in
   *  read-only renders, where the masthead is not selectable at all. */
  onSelectHeaderLine?: (line: HeaderLine) => void;
  /** The one tile whose image is being framed in place, if any. */
  framingKey?: string | null;
  onFrameBlock?: (key: string) => void;
  onFramePlacement?: (key: string, placement: ImagePlacement) => void;
  onFrameExit?: () => void;
  /** The one text block whose words are being typed on the tile, if any. */
  typingKey?: string | null;
  /** Open that editor with everything selected (freshly inserted blocks). */
  typingSelectAll?: boolean;
  onTypeStart?: (key: string) => void;
  /** Text and the spans formatting parts of it, always together. */
  onTextChange?: (key: string, text: string, spans: TextSpan[], source: TextEditSource) => void;
  /** Ctrl+B / I / U with nothing selected: the whole block. */
  onToggleBlockFormat?: (key: string, format: InlineFormatKey) => void;
  /** The live selection inside the editor, for the panel's colour picker. */
  onTextRangeChange?: (range: TextRange | null) => void;
  onTypeEnd?: () => void;
  /** True while a pan tool owns frame drags (space held). */
  disableMarquee?: boolean;
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
  const handlers = useRef({
    onSelectBlock,
    onSelectMany,
    onRemove,
    onFrameBlock,
    onFramePlacement,
    onFrameExit,
    onTypeStart,
    onTextChange,
    onToggleBlockFormat,
    onTextRangeChange,
    onTypeEnd,
    onSelectHeaderLine,
    disableMarquee,
  });
  useEffect(() => {
    handlers.current = {
      onSelectBlock,
      onSelectMany,
      onRemove,
      onFrameBlock,
      onFramePlacement,
      onFrameExit,
      onTypeStart,
      onTextChange,
      onToggleBlockFormat,
      onTextRangeChange,
      onTypeEnd,
      onSelectHeaderLine,
      disableMarquee,
    };
  });
  const toggleSelection = useCallback((key: string, additive?: boolean) => {
    // Toggle semantics (deselect on re-click, add on shift) live with the
    // selection's owner, StorefrontDesigner.
    handlers.current.onSelectBlock(key, additive);
  }, []);
  const removeByKey = useCallback((key: string) => {
    handlers.current.onRemove(key);
  }, []);
  const frameByKey = useCallback((key: string) => {
    handlers.current.onFrameBlock?.(key);
  }, []);
  const placeFrame = useCallback((key: string, placement: ImagePlacement) => {
    handlers.current.onFramePlacement?.(key, placement);
  }, []);
  const exitFrame = useCallback(() => {
    handlers.current.onFrameExit?.();
  }, []);
  const selectHeaderLine = useCallback((line: HeaderLine) => {
    handlers.current.onSelectHeaderLine?.(line);
  }, []);
  const startTyping = useCallback((key: string) => {
    handlers.current.onTypeStart?.(key);
  }, []);
  const changeText = useCallback(
    (key: string, text: string, spans: TextSpan[], source: TextEditSource) => {
      handlers.current.onTextChange?.(key, text, spans, source);
    },
    [],
  );
  const toggleBlockFormat = useCallback(
    (key: string, format: InlineFormatKey) => {
      handlers.current.onToggleBlockFormat?.(key, format);
    },
    [],
  );
  const changeTextRange = useCallback((range: TextRange | null) => {
    handlers.current.onTextRangeChange?.(range);
  }, []);
  const endTyping = useCallback(() => {
    handlers.current.onTypeEnd?.();
  }, []);

  // MARQUEE SELECTION. A drag that starts on the shop frame itself (the
  // board's background, a gap between cells, or a free cell — never a tile
  // or a real control, and never the workspace around the frame, which pans)
  // draws a rubber band and selects every block it touches, live. A plain
  // click on the same surfaces clears the selection. Mouse/pen only: touch
  // on the canvas belongs to scrolling, pinching, and tile drags.
  //
  // The rubber band is drawn imperatively (ref + direct style writes) so a
  // 60Hz drag never re-renders the canvas; only actual selection CHANGES go
  // through React, diffed against the last emitted set.
  const frameRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const marqueeDragged = useRef(false);

  function startMarquee(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.pointerType === "touch") return;
    if (handlers.current.disableMarquee) return;
    const target = event.target as HTMLElement;
    // Tiles keep their own drag; real controls keep their clicks. Free-cell
    // buttons host marquee starts (they cover most open board area) — their
    // insert click still fires when the press never becomes a drag.
    if (target.closest("[data-grid-cell]")) return;
    const button = target.closest("button");
    if (button && button.dataset.gridEmpty === undefined) return;
    const frame = frameRef.current;
    const overlay = marqueeRef.current;
    if (!frame || !overlay) return;
    // No text selection while rubber-banding.
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    marqueeDragged.current = false;
    let lastEmitted = "";

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!marqueeDragged.current && Math.hypot(dx, dy) < 4) return;
      marqueeDragged.current = true;

      const rect = {
        left: Math.min(startX, moveEvent.clientX),
        top: Math.min(startY, moveEvent.clientY),
        right: Math.max(startX, moveEvent.clientX),
        bottom: Math.max(startY, moveEvent.clientY),
      };

      // Draw in the frame's UNSCALED coordinate space (the stage may be
      // zoomed; bounding rects are post-transform).
      const frameRect = frame.getBoundingClientRect();
      const scale =
        frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1;
      overlay.style.display = "block";
      overlay.style.left = `${(rect.left - frameRect.left) / scale}px`;
      overlay.style.top = `${(rect.top - frameRect.top) / scale}px`;
      overlay.style.width = `${(rect.right - rect.left) / scale}px`;
      overlay.style.height = `${(rect.bottom - rect.top) / scale}px`;

      // Select every block the band touches (client-space intersection).
      const hits: string[] = [];
      frame
        .querySelectorAll<HTMLElement>("[data-grid-cell]")
        .forEach((cell) => {
          const r = cell.getBoundingClientRect();
          if (
            r.left < rect.right &&
            rect.left < r.right &&
            r.top < rect.bottom &&
            rect.top < r.bottom
          ) {
            const key = cell.dataset.gridKey;
            if (key) hits.push(key);
          }
        });
      const emitted = hits.join("\n");
      if (emitted !== lastEmitted) {
        lastEmitted = emitted;
        handlers.current.onSelectMany(hits);
      }
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      overlay.style.display = "none";
      // A press that never became a drag is a background click: clear the
      // selection (a free-cell press still fires its own insert click).
      if (!marqueeDragged.current) handlers.current.onSelectBlock(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }

  /** After a marquee drag, swallow the click a free-cell button would fire
   *  on release — the seller was selecting, not inserting. */
  function suppressClickAfterMarquee(event: React.MouseEvent<HTMLDivElement>) {
    if (!marqueeDragged.current) return;
    marqueeDragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

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

  // The canvas font. An uploaded face is declared here as a custom property
  // and applied through it, so text blocks that opt into the same face inherit
  // it without every tile having to be handed a font URL.
  const canvasFont = fontPresentation(theme.font);

  const canvas = (
    <div
      ref={frameRef}
      onPointerDown={startMarquee}
      onClickCapture={suppressClickAfterMarquee}
      className={cn(
        // Relative: the marquee rubber band positions against this frame.
        "relative rounded-md border border-border p-4",
        canvasFont.className,
      )}
      // Schema-constrained: hex is re-gated by the strict regex, the gap is
      // a bounded integer. gridGapStyle sets the --grid-gap token the
      // .ss-grid rule (and the carousel strip) inherit.
      style={{
        ...resolveBackgroundStyle(theme.background, backgroundImageUrl),
        ...gridGapStyle(theme.gridGap),
        ...customFontVars(theme.customFont, customFontUrl),
        ...canvasFont.style,
      }}
    >
      {/* Registers the uploaded face with the document. Renders nothing, and
          fetches nothing until something actually paints in it. */}
      <CustomFontFace customFont={theme.customFont} url={customFontUrl} />
        {/* The marquee rubber band. Position/size are written imperatively
            during a drag; hidden otherwise. */}
        <div
          ref={marqueeRef}
          aria-hidden="true"
          className="pointer-events-none absolute z-40 hidden border border-ring bg-ring/10"
        />
        <StorefrontMasthead
          header={header}
          theme={theme}
          activeLine={activeHeaderLine}
          onSelectLine={selectHeaderLine}
        />

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
              editingKeys={selectedKeys}
              typingKey={typingKey}
              typingSelectAll={typingSelectAll}
              onSelect={onSelectBlock}
              onRemove={onRemove}
              onMove={shiftInCarousel}
              onTypeStart={startTyping}
              onTextChange={changeText}
              onToggleBlockFormat={toggleBlockFormat}
              onTextRangeChange={changeTextRange}
              onTypeEnd={endTyping}
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
            // Per block: a product tile may override the theme's roundness.
            cellStyle={(placement, gridBlock) => ({
              borderRadius: scaledCornerRadius(
                gridBlock
                  ? blockCornerRadius(theme, gridBlock.data)
                  : theme.cornerRadius,
                placement,
              ),
              // A tile being framed draws the rest of its picture OUTSIDE
              // itself, and a later sibling would paint straight over it.
              // Lifting the cell is what keeps the spill visible.
              ...(gridBlock && framingKey === gridBlock.key
                ? { zIndex: 30 }
                : {}),
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
                imageUrl={elementUrls?.[gridBlock.key] ?? null}
                editable={state.editable}
                isEditing={selectedKeys.includes(gridBlock.key)}
                isSoleSelection={
                  selectedKeys.length === 1 && selectedKeys[0] === gridBlock.key
                }
                isFraming={framingKey === gridBlock.key}
                isTyping={typingKey === gridBlock.key}
                typingSelectAll={typingSelectAll}
                // Stable across renders, so a memoised tile only re-renders
                // when its OWN data or selection changes.
                onToggleEdit={toggleSelection}
                onRemove={removeByKey}
                onFrame={frameByKey}
                onFramePlacement={placeFrame}
                onFrameExit={exitFrame}
                onTypeStart={startTyping}
                onTextChange={changeText}
                onToggleBlockFormat={toggleBlockFormat}
                onTextRangeChange={changeTextRange}
                onTypeEnd={endTyping}
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
