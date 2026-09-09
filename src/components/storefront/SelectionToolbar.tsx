"use client";

/**
 * THE SELECTED BLOCK'S OWN TOOLBAR: one island, floating just above whatever
 * is selected, holding whatever can be done to it.
 *
 * It replaces the chip that used to be welded to each tile's top edge. That
 * chip was drawn per tile and had to earn its place on the board: it hung over
 * the neighbouring cell, so the cell had to be lifted clear of its siblings to
 * make the buttons pressable at all; it had to be flush to the tile's edge or
 * the pointer fell through the gap on the way over and the buttons faded out
 * from under the hand reaching for them; it could not be reached by a finger
 * without first selecting the tile, because the lift is spent on hover; and it
 * was drawn at whatever size the board happened to be zoomed to. Every one of
 * those problems is a consequence of putting controls ON the artwork.
 *
 * TIED TO THE BLOCK BY LOGIC, NOT BY A SEAM. It follows the selection around
 * the board and sits a few pixels above it, so there is never a question of
 * which block it belongs to — but it does not touch, and nothing is drawn
 * between the two. Position is the whole relationship.
 *
 * IN THE CANVAS WINDOW, NOT ON THE STAGE. Its coordinates are computed from
 * the selected cells' on-screen boxes and written straight to its transform
 * (see `useAnchorToSelection`), rather than mounting it inside the zoomed
 * stage — the position maths (clamping to the open part of the window,
 * choosing above vs. below the block) is easier in screen pixels than it
 * would be inside a scaled ancestor. But its SIZE still tracks the zoom, on
 * purpose: `useAnchorToSelection` reads the same zoom the stage's own
 * transform uses and writes it into a `scale()` alongside the translate, so
 * this bar grows and shrinks in lockstep with the board and with the grid's
 * own resize and rotate handles (`HANDLE_FACE` in components/grid/Grid.tsx,
 * which get this for free by living ON the stage). Its UNSCALED size — what
 * it draws at when the canvas is at 100% — is `size-6`, matching those same
 * handles.
 *
 * SELECTION, NOT HOVER, is what puts it out, and that is the whole contract:
 * click a block and its tools appear over it; click the board and they are
 * gone. Hovering a tile no longer summons anything, so sweeping across a board
 * is quiet again.
 *
 * WHAT IT OFFERS DEPENDS ON WHAT IS SELECTED, the way Canva's does. A product
 * is a door to a page and a photo to crop; a shape is a colour and an outline;
 * a text block is words to type. Offering the union of those to everything
 * would mean most of the bar being inert most of the time.
 */

import { useRef } from "react";
import {
  Blend,
  Copy,
  Crop,
  Equal,
  FileText,
  Spline,
  Trash2,
  Type,
} from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontBlock } from "@/types/storefront";
import { blockKey } from "@/types/storefront";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { cn } from "@/lib/utils";
import {
  focusRingClass as FOCUS_RING,
  iconPopClass,
  overlaySurfaceClass,
  toolbarTipClass,
  transitionClass as TRANSITION,
} from "@/components/ui/control-styles";
import { blockLabel } from "./block-label";
import {
  NO_INSETS,
  mergeInsets,
  panelInset,
  safeSpan,
  type Insets,
} from "./canvas-geometry";
import { supportsRoundness } from "./shape-geometry";
import type { BlockField } from "./SummonedField";
import { CANVAS_PANEL_ATTR } from "./useCanvasAnchor";
import type { CanvasViewport } from "./useCanvasViewport";

/** How far above the block the bar floats, in screen pixels. */
const ANCHOR_GAP = 10;
/** How close to the canvas window's own edges it is allowed to get. */
const EDGE_PAD = 8;
/**
 * How much of the selected block has to be in the open before the bar is worth
 * drawing. A block panned off the side of the workspace, or buried under a
 * panel, leaves the bar pointing at nothing — and since the bar is clamped
 * inside the window it does not follow the block away, it stops at the edge and
 * sits over whatever is there instead. That is the overlap this threshold ends.
 */
const MIN_VISIBLE_PX = 16;
/**
 * The strip under a tile that the grid's own resize and rotate handles hang in
 * (`HANDLE_ROW` + `HANDLE_FACE` in components/grid/Grid.tsx: 6px of air, then a
 * 24px button). Only spent when the bar has to go BELOW its block, which is
 * also the only time the two would be in the same place — a bar parked on the
 * handles hides the two controls a touchscreen has no other route to.
 */
const HANDLE_ROW_PX = 30;

/**
 * Square, and only ever an icon. `size-6` (24px) — the SAME size as the grid's
 * own resize and rotate handles (`HANDLE_FACE` in components/grid/Grid.tsx),
 * which sit inches away on the same tile. A bar with its own, bigger idea of
 * how large a canvas control should be reads as a second design system laid
 * over the first one, not as a tool that belongs on this board.
 */
const ICON_BTN =
  `group/btn group/tip relative inline-flex size-6 shrink-0 items-center justify-center rounded-sm ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Matches the glyph size `HANDLE_FACE` draws inside that same 24px face. */
const ACTION_ICON = `size-3.5 ${iconPopClass}`;

/** Thin vertical divider between toolbar groups, and the only air on the bar:
 *  the buttons themselves sit flush (see the row's `gap-0`), so this seam is
 *  what says "different kind of action" rather than a gap repeated between
 *  every pair of icons. */
function Divider() {
  return <div aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />;
}

/**
 * One control on the bar.
 *
 * ICONS ONLY, so the bar stays narrow enough to sit over the block it points
 * at rather than sprawling past it. Every label it used to carry was a word
 * for something the icon already said, and the widest of them — a product's
 * own title — was wider than most tiles. The words are not lost: each is the
 * button's accessible name, and each pops as a tip on hover and focus, which
 * is how the bottom toolbar has always labelled its icon-only controls.
 */
function ToolButton({
  tip,
  label,
  onClick,
  pressed,
  danger = false,
  pageNode,
  children,
}: {
  /** The word that pops above the button. */
  tip: string;
  /** The full accessible name, which usually names the block as well. */
  label: string;
  onClick: () => void;
  pressed?: boolean;
  danger?: boolean;
  /** Marks the product-page toggle for the specs that drive it. */
  pageNode?: "open" | "closed";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      suppressHydrationWarning
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      data-page-node={pageNode}
      className={cn(
        ICON_BTN,
        pressed && "bg-accent text-foreground",
        danger &&
          "hover:bg-destructive/5 hover:text-destructive focus-visible:text-destructive",
      )}
    >
      {children}
      <span aria-hidden="true" className={toolbarTipClass}>
        {tip}
      </span>
    </button>
  );
}

/**
 * The picture a Frame gesture would move, or null when there is nothing to
 * move. Mirrors BlockTile's own test: a product frames its photo, an element
 * frames its artwork unless it is set to `contain` (which shows the whole
 * thing already, so there is no overflow to choose between).
 */
function framedSrcOf(
  block: StorefrontBlock,
  productsById: ReadonlyMap<string, Product>,
  elementUrls: Record<string, string> | undefined,
): string | null {
  if (block.type === "product") {
    return productsById.get(block.productId)?.imageUrl ?? null;
  }
  if (block.type === "image" && block.fit !== "contain") {
    return elementUrls?.[blockKey(block)] ?? null;
  }
  return null;
}

/**
 * Keep the bar over the blocks it belongs to.
 *
 * MEASURED FROM THE DOM, not computed from board coordinates. Where a cell
 * ends up on screen is the product of the grid's own layout, the stage's pan
 * and its zoom, and re-deriving that here would be a second implementation of
 * three things that can each disagree with the first. One `getBoundingClientRect`
 * per selected cell cannot.
 *
 * WRITTEN STRAIGHT TO THE ELEMENT, never through state: this runs on every
 * frame of a pan, and a `setState` per frame would re-render the whole bar to
 * move it ten pixels. The stage's own transform is written the same way, for
 * the same reason (see useCanvasViewport).
 *
 * RE-MEASURED EVERY FRAME, rather than on a list of events. The list was
 * tried: pan and zoom through the viewport's own subscription, layout through
 * a ResizeObserver, drags through pointermove — and an arrow-key nudge, which
 * moves a block without firing any of the three, left the bar behind. There is
 * no closed set of "things that can move a block" worth maintaining here, and
 * a frame's work is three `getBoundingClientRect`s and a string compare. The
 * viewport subscription is kept alongside it only for ORDER: it fires right
 * after the stage's transform lands, so a pan never leaves the bar a frame
 * behind the board.
 *
 * ABOVE THE BLOCK, unless that would put it out of the window — a block against
 * the top of the canvas gets its bar underneath instead, clear of the strip its
 * resize and rotate handles hang in.
 *
 * AND INSIDE THE OPEN PART OF THE WINDOW, not merely inside the window. The
 * colour layer stands over the left of the canvas on a desktop and every panel
 * is a sheet lying across the bottom of it on a phone, so "the window" and "the
 * part of it the seller can see" are two different rectangles. The bar is
 * clamped to the second, measured the same way the board measures its own cover
 * (`data-canvas-panel` + panelInset), which is what stops it from being parked
 * on top of an open panel. When the block itself has gone under one — or has
 * been panned off the side entirely — there is nothing left to point at and the
 * bar stands down until it comes back.
 */
function useAnchorToSelection({
  frameRef,
  barRef,
  keys,
  viewport,
}: {
  frameRef: React.RefObject<HTMLDivElement | null>;
  barRef: React.RefObject<HTMLDivElement | null>;
  keys: readonly string[];
  viewport?: CanvasViewport;
}) {
  // Joined, so the effect re-runs when the SELECTION changes but not merely
  // because the caller built a new array of the same keys.
  const signature = keys.join("|");

  useIsomorphicLayoutEffect(() => {
    const frame = frameRef.current;
    const bar = barRef.current;
    if (!frame || !bar || keys.length === 0) return;

    // Read back off the signature rather than closing over `keys`, which is a
    // new array every render: the effect is keyed by the signature, so these
    // are the keys it was started for.
    const anchorKeys = signature.split("|");

    // The last transform written, so a frame that changes nothing costs a
    // string compare rather than a style write and the layout it invalidates.
    let written = "";
    // Same idea for the show/hide half: a boolean compare per frame instead of
    // two style writes.
    let shown: boolean | null = null;

    /** `x`/`y` are the bar's unscaled top-left corner, in the frame's own
     *  coordinates. The element is `origin-top-left`, so translating first and
     *  scaling second grows the box from that corner without the two fighting
     *  over which one is "position" — exactly how the stage's own transform
     *  orders pan before zoom (see useCanvasViewport). */
    function put(x: number, y: number, zoom: number) {
      if (!bar) return;
      const transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${zoom})`;
      if (transform === written) return;
      bar.style.transform = transform;
      written = transform;
    }

    /** Out with the block, or away with it. Visibility rather than an unmount:
     *  the bar is placed from measurements, and a bar that is not in the DOM
     *  has no width to place with. */
    function reveal(on: boolean) {
      if (!bar || on === shown) return;
      shown = on;
      bar.style.visibility = on ? "" : "hidden";
      bar.style.pointerEvents = on ? "" : "none";
      if (on) delete bar.dataset.offscreen;
      else bar.dataset.offscreen = "";
    }

    /** Every panel currently standing on the canvas window, as one set of
     *  insets. Zero for a column docked BESIDE the window, which is what every
     *  panel but the colour layer is on a desktop. */
    function coverOf(area: DOMRect): Insets {
      let insets = NO_INSETS;
      const workspace = {
        left: area.left,
        top: area.top,
        width: area.width,
        height: area.height,
      };
      document
        .querySelectorAll<HTMLElement>(`[${CANVAS_PANEL_ATTR}]`)
        .forEach((panel) => {
          const rect = panel.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          insets = mergeInsets(
            insets,
            panelInset(workspace, {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }),
          );
        });
      return insets;
    }

    function place() {
      if (!frame || !bar) return;
      const area = frame.getBoundingClientRect();
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const key of anchorKeys) {
        const cell = document.querySelector(
          `li[data-grid-cell][data-grid-key="${cssEscape(key)}"]`,
        );
        if (!cell) continue;
        const box = cell.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        left = Math.min(left, box.left - area.left);
        top = Math.min(top, box.top - area.top);
        right = Math.max(right, box.right - area.left);
        bottom = Math.max(bottom, box.bottom - area.top);
      }
      // The stretch of the window no panel is standing on, in the frame's own
      // coordinates. `safeSpan` gives the whole axis back when the panels leave
      // less than a usable strip: with nowhere to move to, the old behaviour
      // (stay inside the window) beats hiding a bar the seller still needs.
      const insets = coverOf(area);
      const [spanLeft, spanRight] = safeSpan(area.width, insets.left, insets.right);
      const [spanTop, spanBottom] = safeSpan(area.height, insets.top, insets.bottom);

      // The SAME zoom the stage's own transform uses (see useCanvasViewport),
      // so this bar grows and shrinks in lockstep with the board and with the
      // grid's own resize/rotate handles — not a fixed screen size, and not a
      // formula of its own. `bar.offsetWidth/Height` is the UNSCALED size (the
      // CSS `size-6` buttons), so the placement maths below sizes and clamps
      // against what the bar will actually occupy on screen once scaled.
      const zoom = viewport?.getZoom() ?? 1;
      const width = bar.offsetWidth * zoom;
      const height = bar.offsetHeight * zoom;

      const minX = spanLeft + EDGE_PAD;
      const maxX = Math.max(minX, spanRight - width - EDGE_PAD);
      const minY = spanTop + EDGE_PAD;
      const maxY = Math.max(minY, spanBottom - height - EDGE_PAD);

      // Nothing measurable to point at: a board that has not laid out yet, or
      // a selection whose cells are gone. The bar still works, so it goes to
      // the top of the window rather than being hidden or left in a corner —
      // unanchored beats unreachable.
      if (!Number.isFinite(left)) {
        reveal(true);
        put(Math.max(minX, (spanLeft + spanRight - width) / 2), minY, zoom);
        return;
      }

      // How much of the block is actually in the open. Off the side of the
      // window, or under a panel, and the bar has nothing to sit over.
      //
      // Measured against the BLOCK's own size as well as the flat threshold: a
      // small shape on a zoomed-out board can be under 16px on screen in the
      // first place, and a bar that vanished for it would be answering "is it
      // visible" with "is it big".
      const showX = Math.min(MIN_VISIBLE_PX, right - left);
      const showY = Math.min(MIN_VISIBLE_PX, bottom - top);
      reveal(
        Math.min(right, spanRight) - Math.max(left, spanLeft) >= showX &&
          Math.min(bottom, spanBottom) - Math.max(top, spanTop) >= showY,
      );

      const above = top - ANCHOR_GAP - height;
      const y =
        above >= minY
          ? above
          : Math.min(bottom + HANDLE_ROW_PX + ANCHOR_GAP, maxY);
      const x = (left + right) / 2 - width / 2;
      put(
        Math.min(Math.max(x, minX), maxX),
        Math.min(Math.max(y, minY), maxY),
        zoom,
      );
    }

    place();

    let frameId = 0;
    // requestAnimationFrame is missing in some non-browser test environments;
    // one placement is still correct there, it simply never follows anything.
    const canLoop = typeof requestAnimationFrame === "function";
    function tick() {
      frameId = requestAnimationFrame(tick);
      place();
    }
    if (canLoop) tick();
    const unsubscribe = viewport?.subscribe(place);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      unsubscribe?.();
    };
  }, [signature, viewport, frameRef, barRef, keys.length]);
}

/** CSS.escape, with a fallback for the jsdom builds that lack it. Every key is
 *  a prefix plus a uuid, so the fallback is never exercised in practice. */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

/** The block's own colour, worn by the button that changes it. */
function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className="size-4 shrink-0 rounded-full border border-border/60 shadow-xs"
    />
  );
}

export function SelectionToolbar({
  blocks,
  productsById,
  elementUrls,
  openPages,
  viewport,
  onOpenPage,
  onType,
  onFrame,
  onOpenColor,
  onOpenSetting,
  onDuplicate,
  onRemove,
}: {
  /** The current selection, in selection order. Nothing is drawn for none. */
  blocks: readonly StorefrontBlock[];
  productsById: ReadonlyMap<string, Product>;
  /** Signed URLs for image elements, keyed by block key. */
  elementUrls?: Record<string, string>;
  /** Products whose page is out on the canvas, so Page reads as a toggle. */
  openPages: readonly string[];
  /** The board's pan and zoom, so the bar can follow a block through both.
   *  Absent in harnesses whose board does neither. */
  viewport?: CanvasViewport;
  onOpenPage: (productId: string) => void;
  onType: (key: string) => void;
  onFrame: (key: string) => void;
  /** Shapes: put this block's fill or its outline in the colour panel, which
   *  is where every colour in this editor is chosen. */
  onOpenColor: (key: string, part: "fill" | "border") => void;
  /** Point the inspector at one of this block's controls: open the panel,
   *  scroll that field into view, mark it. The bar does not edit these
   *  numbers itself — see the note on the shape group below. */
  onOpenSetting: (key: string, field: BlockField) => void;
  /** Copy the given blocks and drop the copies beside them, in one act. Takes
   *  the COPYABLE keys only — a product tile is one per product by design, so
   *  it is filtered out here rather than silently ignored downstream. */
  onDuplicate: (keys: readonly string[]) => void;
  /** Takes the whole selection: removing three tiles is one act, and one
   *  entry in the history, not three. */
  onRemove: (keys: readonly string[]) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const keys = blocks.map(blockKey);
  useAnchorToSelection({ frameRef, barRef, keys, viewport });

  if (blocks.length === 0) return null;

  // Everything but Remove acts on ONE block, so it is offered for one block.
  // With several selected the shared action is the only honest one.
  const only = blocks.length === 1 ? blocks[0] : null;
  const onlyKey = only ? blockKey(only) : null;

  const pageProductId = only?.type === "product" ? only.productId : null;
  const pageIsOpen = pageProductId !== null && openPages.includes(pageProductId);
  const framable =
    only !== null && framedSrcOf(only, productsById, elementUrls) !== null;

  /**
   * NAMED ONLY WHERE THE NAME SAYS SOMETHING. A product's title and a text
   * block's own words identify which of several similar tiles this is; "Square"
   * over a square does not, and the bar is already pointing at it. The blank
   * space is worth more than the label.
   */
  const name = only ? blockLabel(only, productsById) : `${blocks.length} elements`;

  /**
   * WHAT DUPLICATE MEANS HERE. A product tile is one per product by design —
   * copying it would put a second door to the same page on the board — so the
   * button is offered for the blocks that CAN be copied, and not at all for a
   * selection made only of products. A mixed selection duplicates the rest of
   * it, which is what Ctrl+C/Ctrl+V already does from the canvas.
   */
  const copyableKeys = blocks
    .filter((block) => block.type !== "product")
    .map(blockKey);

  const shape = only?.type === "shape" ? only : null;
  /** Opacity belongs to whole objects: a shape and an image element both. */
  const opacityBlock =
    only?.type === "shape" || only?.type === "image" ? only : null;

  return (
    // The frame spans the canvas window and takes no pointer events, so the
    // board underneath stays draggable everywhere the bar itself is not. It is
    // also what the bar's position is measured against.
    <div
      ref={frameRef}
      aria-hidden={blocks.length === 0}
      className="pointer-events-none absolute inset-0 z-40"
    >
      <div
        ref={barRef}
        // Positioned AND SIZED by the one transform useAnchorToSelection
        // writes: translate to the selection's own box, then scale to the
        // canvas's live zoom — left/top stay at zero so that transform is the
        // only thing that ever moves or resizes it. `origin-top-left` matches
        // the translate-then-scale order, so the box grows from the corner it
        // was placed at rather than from its centre.
        className="absolute left-0 top-0 origin-top-left will-change-transform"
      >
        <div
          role="toolbar"
          aria-label={`Tools for ${name}`}
          data-selection-toolbar=""
          // A pointerdown here is chrome, not board: without this the canvas
          // underneath takes it and a slider drag pans the workspace.
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            overlaySurfaceClass,
            // SLIGHTLY ROUNDED, against the brand rule that floating surfaces
            // are sharp (see globals.css). This one rides ON the artwork
            // rather than at the edge of the screen, and a sharp rectangle
            // dropped on a board of rounded tiles reads as a piece of the
            // design rather than as a tool held over it.
            // ONE ROW, ALWAYS. This bar wrapped once — a shape's six controls
            // folded onto a second line — and a two-line island over a tile
            // reads as a panel that has come loose, not as a toolbar. It also
            // covers MORE of the board than the row it was shrinking. Fixed at
            // ICON_BTN's 24px (matching the grid's own handles) with no gap
            // between buttons (a hover fill is its own separation), six of them
            // plus a divider comes to under 170px — nowhere near wide enough to
            // need a second row on any board this ships on.
            "island-enter pointer-events-auto flex flex-nowrap items-center justify-center gap-0 rounded-md",
            "bg-background/95 p-1 backdrop-blur",
          )}
        >
          {/* The product page, as a door on the canvas beside the board. Only
              ever for one product: a node per tile turns the board into a
              diagram, and the seller has already said which they mean. */}
          {pageProductId !== null && (
            <ToolButton
              tip={pageIsOpen ? "Hide page" : "Open page"}
              pressed={pageIsOpen}
              pageNode={pageIsOpen ? "open" : "closed"}
              onClick={() => onOpenPage(pageProductId)}
              label={
                pageIsOpen
                  ? `Close the product page for ${name}`
                  : `Open the product page for ${name}`
              }
            >
              <FileText className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
            </ToolButton>
          )}

          {only?.type === "text" && onlyKey !== null && (
            <ToolButton
              tip="Edit text"
              onClick={() => onType(onlyKey)}
              label={`Edit the text of ${name}`}
            >
              <Type className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
            </ToolButton>
          )}

          {/* A SHAPE'S FOUR, IN CANVA'S ORDER: colour, stroke, corners,
              opacity. Colour opens the colour panel, where every colour in
              this editor is chosen; the other three point at their own
              control in the inspector. Both panels are docked BESIDE the
              canvas, which is the whole reason they are used instead of a
              popover on the bar: this bar rides over the block, so anything
              it opens downward covers the very shape whose number is being
              dragged. */}
          {shape !== null && onlyKey !== null && (
            <>
              <ToolButton
                tip="Color"
                onClick={() => onOpenColor(onlyKey, "fill")}
                label={`Change the colour of ${name}`}
              >
                <ColorSwatch color={shape.color} />
              </ToolButton>

              <ToolButton
                tip="Stroke"
                onClick={() => onOpenSetting(onlyKey, "stroke")}
                label={`Edit the stroke of ${name}`}
              >
                <Equal className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
              </ToolButton>

              {/* Only the kinds whose corners are not already fixed by
                  construction: a circle has no corner to round. */}
              {supportsRoundness(shape.kind) && (
                <ToolButton
                  tip="Corners"
                  onClick={() => onOpenSetting(onlyKey, "corners")}
                  label={`Edit the corner roundness of ${name}`}
                >
                  <Spline className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
                </ToolButton>
              )}
            </>
          )}

          {/* Opacity belongs to whole objects, so a shape and an image element
              both get it, and it is last of the four for both. */}
          {opacityBlock !== null && onlyKey !== null && (
            <ToolButton
              tip="Opacity"
              onClick={() => onOpenSetting(onlyKey, "opacity")}
              label={`Edit the opacity of ${name}`}
            >
              <Blend className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
            </ToolButton>
          )}

          {framable && onlyKey !== null && (
            <ToolButton
              tip="Frame"
              onClick={() => onFrame(onlyKey)}
              label={`Frame the image for ${name}`}
            >
              <Crop className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
            </ToolButton>
          )}

          <Divider />

          {/* The two that act on the block AS A WHOLE, in the order the
              inspector ends on: copy it, or be rid of it. */}
          {copyableKeys.length > 0 && (
            <ToolButton
              tip="Duplicate"
              onClick={() => onDuplicate(copyableKeys)}
              label={
                only
                  ? `Duplicate ${name}`
                  : `Duplicate ${copyableKeys.length} ${
                      copyableKeys.length === 1 ? "element" : "elements"
                    }`
              }
            >
              <Copy className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
            </ToolButton>
          )}

          <ToolButton
            tip="Delete"
            danger
            onClick={() => onRemove(keys)}
            label={
              only
                ? `Remove ${name} from grid`
                : `Remove ${blocks.length} elements from grid`
            }
          >
            <Trash2 className={ACTION_ICON} strokeWidth={2} aria-hidden="true" />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
