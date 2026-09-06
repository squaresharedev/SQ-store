"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Crop, FileText, Type, X } from "lucide-react";
import type { Product } from "@/types/product";
import {
  DEFAULT_IMAGE_PLACEMENT,
  resolveCardStyle,
  resolvePriceTagPosition,
  resolveTitlePosition,
  titleBandRow,
  type ImagePlacement,
  type StorefrontBlock,
  type StorefrontTheme,
  type TextSpan,
  type TileSpot,
} from "@/types/storefront";
import {
  nearestTileSpot,
  priceSpots,
  spotAfterArrow,
  titleSpots,
  type SpotArrow,
} from "@/lib/storefront/tile-spots";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/Tooltip";
import { BlockFace } from "./BlockFace";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";
import { TileImageFramer, TileImageGhost } from "./TileImageFramer";
import {
  TileSpotDragLayer,
  type SpotDrop,
  type SpotToken,
  type TileSpotDrag,
} from "./TileSpotDragLayer";

/** Small square control button used in tile chrome. */
export const TILE_CONTROL_CLASS =
  "inline-flex size-6 items-center justify-center rounded-none text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-40";

/**
 * The chip that holds tile controls, revealed on hover/focus for fine pointers
 * (the surrounding grid cell is the `group`) and kept out for as long as the
 * tile is selected.
 *
 * ABOVE the tile, outside it. It used to sit in whichever corner nothing else
 * had claimed, which was a losing game: a title band spans a whole row, a price
 * tag can float to any of seven spots, and the chip is painted over both — so
 * the seller's own work kept disappearing under the controls for editing it.
 * Out here there is no corner to compete for, and the tile's face is never
 * covered by its own chrome. The grid's resize and rotate handles hang out of
 * the opposite edge for the same reason.
 *
 * SEAMLESS, not floating and not merely touching: the chip is meant to read as
 * a tab growing out of the tile, one continuous shape, not a separate pill
 * parked near it. Three things make that read correctly rather than as a
 * glitch:
 *
 *   - FLUSH, with a hairline of overlap (`-mb-px`) rather than sitting exactly
 *     at the edge. A subpixel gap is possible wherever a zoomed stage rounds
 *     two elements' coordinates a fraction of a pixel apart, and that sliver
 *     is dead space for the pointer — it belongs to neither this chip nor the
 *     tile, so crossing it drops `:hover` off the cell and fades the chip out
 *     from under the hand reaching for it.
 *   - NO BORDER on the edge that overlaps (`border-b-0`). A chip with a full
 *     border sitting a pixel into the tile draws TWO border lines on top of
 *     each other there — the chip's own bottom edge and the tile's top edge —
 *     which is what actually reads as an overlap: a visibly doubled, slightly
 *     misaligned line. Dropping the chip's own bottom border leaves only the
 *     tile's line showing through, so the seam disappears instead of doubling.
 *   - ROUNDED ONLY ON TOP. The touching corners stay square so the chip's
 *     silhouette continues the tile's own top edge instead of notching into
 *     it; the far corners are rounded, which is what still reads it as a
 *     control and not a permanent extension of the tile itself.
 *
 * Hidden chrome takes no presses either (`pointer-events-none` while
 * transparent). An invisible chip still hit-tests, and this one hangs over the
 * cell above, which on this board is a free cell whose whole job is to be
 * clicked.
 */
export const TILE_CONTROL_CHIP_CLASS = cn(
  "absolute bottom-full right-0 z-20 -mb-px flex items-center gap-0.5 p-0.5",
  "rounded-t-sm rounded-b-none border border-b-0 border-border bg-background/95",
  // Selected chrome takes the selection's own colour, so the chip reads as an
  // edge of the tile that is ringed rather than as a widget parked on it.
  "group-has-[[data-block-selected]]:border-ring",
  "transition-opacity duration-base ease-standard motion-reduce:transition-none",
  "pointer-fine:pointer-events-none pointer-fine:opacity-0",
  "pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100",
  "pointer-fine:group-focus-within:pointer-events-auto pointer-fine:group-focus-within:opacity-100",
  // Selected is a state, not a moment: the controls for the block being worked
  // on stay out and stay pressable whether or not the pointer is on it.
  "pointer-fine:group-has-[[data-block-selected]]:pointer-events-auto",
  "pointer-fine:group-has-[[data-block-selected]]:opacity-100",
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
  onOpenPage,
  pageOpen = false,
  onFrame,
  onFramePlacement,
  onFrameExit,
  onTypeStart,
  onTextChange,
  onToggleBlockFormat,
  onTextRangeChange,
  onTypeEnd,
  onSpotChange,
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
  /** Product tiles only: open this product's page as an artboard beside the
   *  board. Absent on every read-only path, which then draws no node. */
  onOpenPage?: (productId: string) => void;
  /** True when that page is already out, so the node reads as connected. */
  pageOpen?: boolean;
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
  /** Product blocks: the seller dragged (or arrowed) the title or the price to
   *  a new home. `below` only ever arrives for the price. */
  onSpotChange?: (key: string, token: SpotToken, drop: SpotDrop) => void;
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
  // The tile's own box, which is what a spot drag measures against.
  const tileRef = useRef<HTMLDivElement | null>(null);

  // ── Placing the title and the price by dragging them ──────────────────
  //
  // Armed only while this tile is the SOLE selection and nothing else has the
  // tile (framing and typing each own every gesture on the surface). A rotated
  // tile is excluded because getBoundingClientRect returns the axis-aligned
  // box of a rotated element, so the pointer-to-spot mapping would lie; revisit
  // when rotation lands and toLocalPoint can un-rotate the pointer first.
  const placeable =
    editable &&
    block.type === "product" &&
    isSoleSelection &&
    !isFraming &&
    !isTyping &&
    onSpotChange !== undefined &&
    !block.rotation;

  const card = placeable
    ? resolveCardStyle(theme, block.type === "product" ? block.style : undefined)
    : null;

  // Where the two tokens sit right now, resolved exactly as the face resolves
  // them, so a drag starts from what the seller can see.
  const titleAt = card
    ? resolveTitlePosition(card.titlePosition, {
        titleStyle: card.titleStyle,
        cornerRadius: card.cornerRadius,
      })
    : null;
  // The row the band really takes out of the image — none at all when the
  // title is switched off, however the style would have drawn it.
  const bandRow = card ? titleBandRow(card) : null;
  const priceAt =
    card &&
    resolvePriceTagPosition(card.priceTagPosition, {
      cornerRadius: card.cornerRadius,
      titleBand: bandRow,
    });

  type Flight = {
    token: SpotToken;
    drop: SpotDrop;
    available: readonly TileSpot[];
    /** True once the press has actually moved the token, so the click that
     *  ends a drag can be swallowed while a plain tap still reaches the tile. */
    moved: boolean;
  };
  // The flight is held in a REF and mirrored into state. The ref is the
  // authority because the drop has to read it from an event handler and then
  // call the parent's mutator: doing that inside a setState updater runs it in
  // the render phase, where React discards the parent's update and the drag
  // silently commits nothing. State exists only so the tile repaints.
  const flyingRef = useRef<Flight | null>(null);
  const [flying, setFlying] = useState<Flight | null>(null);
  // Outlives the flight by one event: the click arrives after pointerup, when
  // the flight itself has already been cleared.
  const movedRef = useRef(false);
  // Tears down the window listeners a grab installed. Held in a ref so an
  // unmount mid-drag cannot leave them behind.
  const untrackRef = useRef<(() => void) | null>(null);
  useEffect(() => () => untrackRef.current?.(), []);

  function setFlight(next: Flight | null) {
    flyingRef.current = next;
    setFlying(next);
  }

  function spotsFor(token: SpotToken): readonly TileSpot[] {
    if (!card) return [];
    return token === "title"
      ? titleSpots(card.titleStyle, card.cornerRadius)
      : priceSpots(card.cornerRadius, bandRow);
  }

  /** Where a pointer at this position wants to put the token. The band is the
   *  price's one home that is not a spot, so it is hit-tested first. */
  function dropAt(token: SpotToken, clientX: number, clientY: number): SpotDrop {
    const tile = tileRef.current;
    if (!tile) return flyingRef.current?.drop ?? "middle-center";
    if (token === "price") {
      const band = tile
        .querySelector("[data-title-band]")
        ?.getBoundingClientRect();
      if (
        band &&
        clientX >= band.left &&
        clientX <= band.right &&
        clientY >= band.top &&
        clientY <= band.bottom
      ) {
        return "below";
      }
    }
    return nearestTileSpot(
      clientX,
      clientY,
      tile.getBoundingClientRect(),
      spotsFor(token),
    );
  }

  // WHERE THE CONTROL CHIP SITS is no longer a question worth asking: it hangs
  // above the tile, outside it (see TILE_CONTROL_CHIP_CLASS). It used to hunt
  // for whichever corner the title band, the price tag and the sold-out badge
  // had all left free — a search that could not always succeed, since a band
  // claims a whole row and a tag can float to any of seven spots, and that
  // failure meant the chip painted over the seller's own work and ate the press
  // meant for it. Out of the tile, there is nothing to collide with.

  const spotDrag: TileSpotDrag | undefined = placeable
    ? {
        title: card!.showTitle,
        price: card!.priceTagPosition !== "hidden",
        active: flying ? { token: flying.token, drop: flying.drop } : null,
        onGrab: (token) => {
          const from: SpotDrop =
            token === "title"
              ? (titleAt ?? "middle-center")
              : priceAt === "below" || priceAt === "hidden"
                ? "below"
                : (priceAt ?? "middle-center");
          setFlight({
            token,
            drop: from,
            available: spotsFor(token),
            moved: false,
          });

          // Tracking on the WINDOW, not on the token: the token moves as it is
          // dragged, and a listener bound to it dies with the node.
          const onPointerMove = (event: PointerEvent) => {
            const current = flyingRef.current;
            if (!current) return;
            const drop = dropAt(current.token, event.clientX, event.clientY);
            if (drop !== current.drop) setFlight({ ...current, drop, moved: true });
          };
          const finish = (commit: boolean) => {
            untrackRef.current?.();
            const current = flyingRef.current;
            setFlight(null);
            movedRef.current = commit && (current?.moved ?? false);
            if (commit && current?.moved) {
              onSpotChange?.(blockKey, current.token, current.drop);
            }
          };
          const onPointerUp = () => finish(true);
          const onPointerCancel = () => finish(false);
          // Escape belongs on the WINDOW, not on the token: a pointer drag
          // never focuses the thing it is dragging (the press is
          // preventDefault-ed so the tile does not scroll), so a key handler
          // on the token would never see it.
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            finish(false);
          };

          window.addEventListener("pointermove", onPointerMove);
          window.addEventListener("pointerup", onPointerUp);
          window.addEventListener("pointercancel", onPointerCancel);
          window.addEventListener("keydown", onKeyDown, true);
          untrackRef.current = () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
            window.removeEventListener("keydown", onKeyDown, true);
            untrackRef.current = null;
          };
        },
        onCancel: () => {
          untrackRef.current?.();
          setFlight(null);
          movedRef.current = false;
        },
        onArrow: (token, key: SpotArrow) => {
          // Each press commits, exactly like arrowing a block around the board.
          // There is no pending state to confirm, so there is nothing to lose
          // by looking away.
          const available = spotsFor(token);
          if (available.length === 0) return;
          // A price sitting in the band is not on the board yet, so its first
          // arrow LIFTS it onto the board rather than moving it across one.
          const lifting =
            token === "price" && (priceAt === "below" || priceAt === "hidden");
          const from =
            token === "title" ? (titleAt ?? available[0]) : lifting
              ? available[0]
              : ((priceAt as TileSpot | null) ?? available[0]);
          const next = lifting ? from : spotAfterArrow(from, key, available);
          // Nothing to write when the token is already against that edge.
          if (lifting || next !== from) onSpotChange?.(blockKey, token, next);
        },
        // A press that moved the token is not also a click on the tile. One
        // that never moved is, so tapping a label still selects as before.
        onTokenClick: (event) => {
          if (movedRef.current) event.stopPropagation();
          movedRef.current = false;
        },
      }
    : undefined;

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // Presses on the tile's own controls (remove, etc.) keep their own
    // click behavior.
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
      ref={tileRef}
      // How the in-place text editor finds the tile again: Escape puts the
      // focus back here, so the canvas keys (arrows, Delete) resume.
      data-block-tile=""
      // THE ONE THING THE GRID NEEDS TO KNOW about selection, and the reason
      // it is an attribute rather than a prop: a cell whose controls are out
      // has to be lifted clear of its neighbours (CHROME_Z), and the controls
      // hang outside the cell, so the lift belongs to the cell rather than to
      // anything React renders inside it. `:has()` in globals.css reads this,
      // and so do the handles' own `group-has-` variants, so there is no
      // plumbing and the grid stays presentation-agnostic.
      data-block-selected={isEditing ? "" : undefined}
      // PLT-02: Plain focusable container, NOT role="button", so nested
      // buttons (Remove, Frame, Type, page node) are not interactive-in-
      // interactive. Keyboard users press Enter/Space on this div to toggle
      // the selection; a pointer user does the same by clicking the tile
      // itself, which is also why there is no separate "Select" button in
      // the chip below.
      // tabIndex without a role is valid and keeps the focus ring.
      tabIndex={selectable ? 0 : isTyping ? -1 : undefined}
      aria-label={
        selectable
          ? isEditing
            ? `Selected: ${label}. Press Enter to deselect.`
            : `${label}. Press Enter to select and edit.`
          : undefined
      }
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
        // Inherited (not passed in) so the grid and the drag overlay stay in
        // sync for free.
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
          cell is the `group`); always visible on coarse pointers, and kept
          out for as long as the tile is selected (TILE_CONTROL_CHIP_CLASS's
          own `group-has-[[data-block-selected]]` variants answer that, so
          nothing here has to). Hidden while framing: the tile is a
          single-purpose surface then, and a Remove button under a dragging
          finger is a trap.
          PLT-02: Outer div is no longer role="button", so these buttons are
          no longer nested-interactive; selecting the tile is a plain click
          on it (or Enter/Space when focused), so there is no "Select" button
          here to do that job. The one control unique to a PRODUCT tile, its
          page node, leads the chip instead, in the spot Select used to hold. */}
      {editable &&
        !isFraming &&
        !isTyping &&
        (onRemove ||
          framable ||
          typable ||
          (block.type === "product" && onOpenPage && isSoleSelection)) && (
          <div data-tile-chrome="" className={TILE_CONTROL_CHIP_CLASS}>
            {/* THE PAGE NODE. A product tile is a door: this is the handle on
                it. Clicking it puts that product's page on the canvas beside
                the board, joined to this tile by a line, so the thing a buyer
                taps and the thing they land on are visible at the same time.

                Only on the sole selection: a node on every tile at once would
                turn the board into a diagram, and the seller has already said
                which product they mean by clicking it. Leads the chip, where
                the tile's own Select control used to sit: a product tile has
                nothing left to put there now that selecting is a plain click
                on the tile, and this is the one action every other tile kind
                lacks. */}
            {block.type === "product" && onOpenPage && isSoleSelection && (
              <Tooltip label={pageOpen ? "Hide product page" : "Open product page"}>
                <button
                  type="button"
                  data-page-node={pageOpen ? "open" : "closed"}
                  // The grid starts a move on pointerdown; the node is not a drag.
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenPage(block.productId);
                  }}
                  aria-pressed={pageOpen}
                  aria-label={
                    pageOpen
                      ? `Close the product page for ${label}`
                      : `Open the product page for ${label}`
                  }
                  className={cn(TILE_CONTROL_CLASS, pageOpen && "bg-accent text-foreground")}
                >
                  <FileText className="size-3.5" strokeWidth={2} aria-hidden="true" />
                </button>
              </Tooltip>
            )}
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
            {/* Frame. The only route in on touch that is worth trusting --
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
      {/* Where the token can land, drawn only while one is in flight. It sits
          above the face and takes no pointer events: the token itself holds
          the capture for the whole gesture. */}
      {flying && (
        <TileSpotDragLayer
          available={flying.available}
          candidate={flying.drop === "below" ? null : flying.drop}
        />
      )}

      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit] [contain:paint]">
        <BlockFace
          block={block}
          product={product}
          theme={theme}
          imageUrl={imageUrl}
          imageRef={isFraming ? imageRef : undefined}
          spotDrag={spotDrag}
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
        {/* SF-01: Draft product badge in the editor only. Buyers never see this
            tile at all (the block is in the grid, but the product link is dead),
            so the seller needs a clear signal that publishing this grid sends
            buyers to a 404. The badge is inside contain:paint so it stays
            within the tile's bounds on any corner radius. */}
        {editable && block.type === "product" && product?.status === "draft" && (
          <span
            aria-label="Draft product -- buyers cannot reach this link"
            className="absolute bottom-1.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm bg-amber-100 px-1.5 py-0.5 font-inter text-[10px] font-semibold leading-none text-amber-800 shadow-sm dark:bg-amber-900/50 dark:text-amber-300"
          >
            Draft
          </span>
        )}
      </div>
    </div>
  );
});
