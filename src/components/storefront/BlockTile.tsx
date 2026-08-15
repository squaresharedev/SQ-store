"use client";

import { memo, useRef } from "react";
import { Crop, Type, X } from "lucide-react";
import type { Product } from "@/types/product";
import {
  DEFAULT_IMAGE_PLACEMENT,
  type ImagePlacement,
  type StorefrontBlock,
  type StorefrontTheme,
  type TextSpan,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { BlockFace } from "./BlockFace";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";
import { TileImageFramer, TileImageGhost } from "./TileImageFramer";

/** Small square control button used in tile chrome (also by CarouselStrip's
 *  move buttons, so all tile controls look identical). */
export const TILE_CONTROL_CLASS =
  "inline-flex size-6 items-center justify-center rounded-none text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40";

/** The floating chip that holds tile controls, revealed on hover/focus for
 *  fine pointers (the surrounding grid/strip cell is the `group`). */
export const TILE_CONTROL_CHIP_CLASS = cn(
  "absolute z-20 flex items-center gap-0.5 rounded-sm border border-border bg-background/95 p-0.5",
  "transition-opacity duration-base ease-standard motion-reduce:transition-none",
  "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
);

/**
 * The surface of one storefront block inside the shared <Grid>: the product,
 * text, or shape face, plus (in editable mode) a remove control. CLICKING the
 * tile selects it: its editor card opens in the inspector panel (Enter/Space
 * do the same for keyboard users); no styling controls live on the tile
 * itself. Reorder is the grid's whole-surface drag, resize its corner handle.
 * A product block whose product no longer exists renders a flagged, removable
 * tile, never a crash.
 *
 * A text block's WORDS are the exception, and are typed on the tile: click a
 * selected text tile (or press Enter on it, or use its Type button) and the
 * face becomes the editor. Click-to-select then click-to-type, rather than
 * double-click, because selecting a text block opens the colour panel and the
 * board slides out from under the second click of a double. Double-click
 * still works when it lands, and is what a product tile uses to frame its
 * picture — the two never collide, since neither kind does both.
 */
/**
 * MEMOISED, and the props are designed for it: the callbacks take the block's
 * key so callers can pass ONE stable function rather than a fresh closure per
 * tile. Without this, an unrelated edit (typing the storefront name) re-rendered
 * every tile on the board — measured at 67ms per keystroke on a full canvas.
 */
export const BlockTile = memo(function BlockTile({
  blockKey,
  block,
  product,
  theme,
  imageUrl,
  editable,
  isEditing = false,
  isFraming = false,
  isSoleSelection = false,
  isTyping = false,
  typingSelectAll = false,
  onToggleEdit,
  onRemove,
  onFrame,
  onFramePlacement,
  onFrameExit,
  onTypeStart,
  onTextChange,
  onToggleBlockFormat,
  onTextRangeChange,
  onTypeEnd,
}: {
  /** Identity handed back to the callbacks, so they can stay stable. */
  blockKey: string;
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  /** Image blocks only: the server-signed URL for this element's artwork. */
  imageUrl?: string | null;
  editable: boolean;
  /** True when this block is the one open in the inspector panel. */
  isEditing?: boolean;
  /** True when this tile's image is being framed in place. */
  isFraming?: boolean;
  /** True when this block is the ONLY one selected — which is what makes the
   *  next click on a text tile mean "type" rather than "deselect". */
  isSoleSelection?: boolean;
  /** True when this text tile's words are being typed on the tile. */
  isTyping?: boolean;
  /** Open the editor with everything selected (a block whose text is still
   *  the placeholder it was inserted with). */
  typingSelectAll?: boolean;
  /** Edit-mode callbacks — only consulted when `editable` (static previews
   *  omit them). `additive` is true for shift-clicks: add to / remove from
   *  the selection instead of replacing it. */
  onToggleEdit?: (key: string, additive?: boolean) => void;
  onRemove?: (key: string) => void;
  /** Enter frame mode on this tile. */
  onFrame?: (key: string) => void;
  onFramePlacement?: (key: string, placement: ImagePlacement) => void;
  onFrameExit?: () => void;
  /** Text blocks: start / apply / end typing on the tile. */
  onTypeStart?: (key: string) => void;
  /** Text and the spans formatting parts of it, always together. */
  onTextChange?: (key: string, text: string, spans: TextSpan[], source: TextEditSource) => void;
  /** Ctrl+B / I / U with nothing selected: the whole block. */
  onToggleBlockFormat?: (key: string, format: InlineFormatKey) => void;
  /** The live selection inside the editor, for the panel's colour picker. */
  onTextRangeChange?: (range: TextRange | null) => void;
  onTypeEnd?: () => void;
}) {
  // Include the text content so several text blocks stay distinguishable to
  // screen readers.
  const label =
    block.type === "product"
      ? (product?.title ?? "Removed product")
      : block.type === "shape"
        ? `${block.kind} shape`
        : block.type === "image"
          ? // The seller's own words about the artwork, when they gave any.
            block.alt.trim()
            ? `Image: ${block.alt.trim().slice(0, 30)}`
            : "Image element"
          : block.text.trim()
            ? `Text: ${block.text.trim().slice(0, 30)}`
            : "Text block";

  // While the words are being typed, the tile is a text field and nothing
  // else: a click inside them must not toggle the selection out from under
  // the caret.
  const selectable = editable && onToggleEdit !== undefined && !isTyping;

  // Typing needs a text block and somewhere to send the keystrokes.
  const typable =
    editable &&
    block.type === "text" &&
    onTypeStart !== undefined &&
    onTextChange !== undefined &&
    onToggleBlockFormat !== undefined &&
    onTextRangeChange !== undefined &&
    onTypeEnd !== undefined;

  // Framing needs a picture to frame AND a crop to position. A product block
  // whose product was deleted, or one with no photo uploaded, has nothing to
  // move; an element set to `contain` shows the whole artwork already, so
  // there is no overflow to choose between.
  //
  // Both kinds resolve to ONE picture here, so everything downstream (the
  // ghost, the framer, the double-click handler) reads a single source and
  // cannot disagree about whether this tile can be framed.
  const framedSrc =
    block.type === "product"
      ? (product?.imageUrl ?? null)
      : block.type === "image" && block.fit !== "contain"
        ? (imageUrl ?? null)
        : null;
  const framable = editable && onFrame !== undefined && framedSrc !== null;

  // Where the pointer went down, so a whole-surface DRAG that ends over the
  // tile is not mistaken for a select click (the grid starts drags after 4px
  // of travel; a click that traveled further was a drag).
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  // The framed picture itself, so the framer can read its intrinsic size.
  const imageRef = useRef<HTMLImageElement | null>(null);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Presses on the tile's own controls (remove, carousel arrows) keep their
    // own click behavior.
    if ((event.target as HTMLElement).closest("button")) return;
    // The second click of a double-click carries detail 2. Letting it through
    // would toggle the selection straight back off under the dblclick that is
    // about to open frame mode.
    if (event.detail > 1) return;
    const down = pointerDownAt.current;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) {
      return;
    }
    // Clicking a text tile that is ALREADY the whole selection means "let me
    // type", not "deselect" — the second half of click-to-select,
    // click-to-edit. Shift-clicks are building a selection and keep the
    // toggle; so does a click on one member of a multi-selection, which is
    // still choosing which block to work on.
    if (typable && isSoleSelection && !event.shiftKey) {
      onTypeStart?.(blockKey);
      return;
    }
    onToggleEdit?.(blockKey, event.shiftKey);
  }

  function handleDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    // A tile is one or the other: pictures frame, words type.
    if (framable) onFrame?.(blockKey);
    else if (typable) onTypeStart?.(blockKey);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Only keys on the tile itself; keys inside inner buttons keep their own.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // Enter on a text tile that is already selected starts typing — the
      // keyboard's double-click. Space stays pure selection, so there is
      // always a key that only toggles.
      if (typable && isEditing && event.key === "Enter" && !event.shiftKey) {
        onTypeStart?.(blockKey);
        return;
      }
      onToggleEdit?.(blockKey, event.shiftKey);
      return;
    }
    // The keyboard route into framing. "f" is free: the grid owns the arrows
    // and Enter/Space, and the designer's shortcuts are all modified.
    if (framable && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      onFrame?.(blockKey);
    }
  }

  return (
    <div
      // How the in-place text editor finds the tile again: Escape puts the
      // focus back here, so the canvas keys (arrows, Delete) resume.
      data-block-tile=""
      // The tile itself is the select control: click (or Enter/Space) opens
      // the block's editor card in the inspector panel.
      role={selectable ? "button" : undefined}
      // Out of the tab order while it is a text field, but still a focus
      // TARGET, which is what lets Escape land the caret back on the tile.
      tabIndex={selectable ? 0 : isTyping ? -1 : undefined}
      aria-label={
        selectable
          ? isEditing
            ? `Close ${label} settings`
            : `Edit ${label}`
          : undefined
      }
      aria-pressed={selectable ? isEditing : undefined}
      onPointerDown={
        selectable
          ? (event) => {
              pointerDownAt.current = { x: event.clientX, y: event.clientY };
            }
          : undefined
      }
      onClick={selectable ? handleClick : undefined}
      onDoubleClick={framable || (typable && !isTyping) ? handleDoubleClick : undefined}
      onKeyDown={selectable ? handleKeyDown : undefined}
      className={cn(
        "relative h-full w-full",
        // The tile fills its cell exactly, so inheriting the cell's corner
        // radius makes the card border and the selection ring CURVE with the
        // roundness setting instead of being sliced square by the cell's clip.
        // Inherited (not passed in) so the grid, the carousel strip, and the
        // drag overlay all stay in sync for free.
        "rounded-[inherit]",
        // Product blocks are bordered cards; text and shape blocks sit
        // chrome-less on the canvas, so the kinds never read as the same thing.
        block.type === "product"
          ? "border border-border bg-card"
          : "bg-transparent",
        // Inset ring so the "being edited" state reads clearly without being
        // clipped by the grid cell's overflow.
        isEditing && !isFraming && "ring-2 ring-inset ring-ring",
        // Typing is a mode, not just a selection, so it gets its own mark: a
        // dashed inset outline (rings cannot be dashed) that says "this tile
        // is a field right now".
        isTyping &&
          "outline-2 outline-dashed outline-ring -outline-offset-2",
        selectable &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        // In the designer, a block buyers won't see (sold out + hideSoldOut)
        // stays visible but dimmed so the seller can still manage it.
        editable &&
          block.type === "product" &&
          block.soldOut &&
          theme.hideSoldOut &&
          "opacity-50",
      )}
    >
      {/* The rest of the picture, dimmed, spilling past the tile. FIRST in the
          DOM on purpose: it paints beneath the face, so the part inside the
          frame stays at full strength without any masking. */}
      {isFraming && framedSrc && (
        <TileImageGhost
          src={framedSrc}
          placement={
            (block.type === "product" || block.type === "image"
              ? block.imagePlacement
              : undefined) ?? DEFAULT_IMAGE_PLACEMENT
          }
        />
      )}

      {/* Tile controls. Revealed on hover/focus for fine pointers (the grid
          cell is the `group`); always visible on coarse pointers. Hidden
          while framing: the tile is a single-purpose surface then, and a
          Remove button under a dragging finger is a trap. */}
      {editable && !isFraming && !isTyping && (onRemove || framable || typable) && (
        <div
          className={cn(
            TILE_CONTROL_CHIP_CLASS,
            "right-1 top-1",
            isEditing && "pointer-fine:opacity-100",
          )}
        >
          {/* Type. Same reasoning as Frame below: double-tap is not a gesture
              to hand a text field to on touch. */}
          {typable && (
            <button
              type="button"
              onClick={() => onTypeStart?.(blockKey)}
              aria-label={`Edit the text of ${label}`}
              className={TILE_CONTROL_CLASS}
            >
              <Type className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          {/* Frame. The only route in on touch that is worth trusting —
              double-tap is unreliable on iOS, where the browser claims it. */}
          {framable && (
            <button
              type="button"
              onClick={() => onFrame?.(blockKey)}
              aria-label={`Frame the image for ${label}`}
              className={TILE_CONTROL_CLASS}
            >
              <Crop className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(blockKey)}
              aria-label={`Remove ${label} from grid`}
              className={cn(TILE_CONTROL_CLASS, "hover:text-destructive")}
            >
              <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* The framing surface sits ABOVE the face and owns every gesture that
          lands on it, which is what keeps a drag here from moving the block. */}
      {isFraming && framedSrc && (
        <TileImageFramer
          placement={
            (block.type === "product" || block.type === "image"
              ? block.imagePlacement
              : undefined) ?? DEFAULT_IMAGE_PLACEMENT
          }
          imageRef={imageRef}
          label={label}
          onChange={(next) => onFramePlacement?.(blockKey, next)}
          onExit={() => onFrameExit?.()}
        />
      )}

      {/* The face clips ITSELF to the corner radius (the cell deliberately
          no longer clips), so the controls above stay visible in the square
          corner of a circle/pill tile. contain:paint keeps the per-cell paint
          isolation the grid used to provide. */}
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit] [contain:paint]">
        <BlockFace
          block={block}
          product={product}
          theme={theme}
          imageUrl={imageUrl}
          imageRef={isFraming ? imageRef : undefined}
          textEditing={typable && isTyping}
          textSelectAll={typingSelectAll}
          onTextChange={
            typable
              ? (text, spans, source) => onTextChange?.(blockKey, text, spans, source)
              : undefined
          }
          onToggleBlockFormat={
            typable
              ? (format) => onToggleBlockFormat?.(blockKey, format)
              : undefined
          }
          onTextRangeChange={typable ? onTextRangeChange : undefined}
          onTextEditEnd={typable ? onTypeEnd : undefined}
        />
      </div>
    </div>
  );
});
