"use client";

import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import { ShoppingBag } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockCornerRadius,
  blockKey,
  isFreelyArranged,
  layerOrder,
  type HeaderLine,
  type ImagePlacement,
  type ProductPageConfig,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontSeller,
  type StorefrontTheme,
  type TextSpan,
} from "@/types/storefront";
import { ProductPageArtboard } from "./ProductPageArtboard";
import { PageConnectors } from "./PageConnectors";
import { DeviceSizeSwitch, type PreviewDevice } from "./DeviceSizeSwitch";
import { cn } from "@/lib/utils";
import {
  customFontVars,
  fontPresentation,
} from "@/lib/theme/storefront-fonts";
import { Grid } from "@/components/grid/Grid";
import {
  FRAME_Z,
  OVERLAY_Z,
  type GridBlock,
  type GridPlacement,
} from "@/components/grid/gridConstants";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";
import { BlockTile } from "./BlockTile";
import type { SpotDrop, SpotToken } from "./TileSpotDragLayer";
import { CustomFontFace } from "./CustomFontFace";
import { StorefrontMasthead } from "./StorefrontMasthead";
import { resolveBackgroundStyle } from "./background-presets";
import { gridGapStyle, scaledCornerRadius, tileClipStyle } from "./config-maps";
import type { CanvasViewport } from "./useCanvasViewport";
import { iconPopClass, primaryButtonClass } from "@/components/ui/control-styles";

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

/** Mobile preview's board width — matches the fluid column's own `max-w-sm`,
 *  just spelled as a number so a product page artboard can be handed the
 *  exact same width rather than picking one of its own. */
const MOBILE_PREVIEW_WIDTH = 384;

/**
 * A product page's own "desktop" width, when its switch is on that setting.
 *
 * NOT the board's natural design-view width: that is `columns * cell size`,
 * a number that describes the SELLER'S GRID, not a browser. A 6-column board
 * (the default) is only ~634px wide, under the page's own @3xl container
 * breakpoint (768px, see ProductPageView.tsx) for the image-left/details-
 * right layout — so the page never left its single-column, mobile-style
 * stack no matter how "desktop" the seller's board was, just scaled up. This
 * is comfortably past that breakpoint AND past the page's own capped content
 * width (max-w-[76rem] = 1216px), so the preview shows the page exactly as
 * matured/centred as it will ever get on a real desktop browser.
 */
const PRODUCT_PAGE_DESKTOP_WIDTH = 1280;

/**
 * Empty band above the whole stage row (the board AND the pages beside it),
 * in px.
 *
 * Each connector (see PageConnectors) leaves the board's own top-right corner
 * heading straight up, arcs over, and comes straight down into a page's
 * top-centre: an arch, which needs headroom above both ends to rise into.
 * Reserving that headroom here, above the row rather than only above the
 * pages, is also what keeps a page's own top level with the board's: the two
 * start the same distance below this band, so a page reads as belonging to
 * the storefront it opened from rather than hanging lower on the workspace.
 * And reserving it as real layout space (padding on the stage, not a margin
 * that only the connectors know about) is what keeps an arc's peak inside the
 * box Fit measures, so fitting the canvas never crops one off the top.
 *
 * Comfortably above the tallest arc a connector ever draws (see ARC_LIFT_MAX
 * in PageConnectors): every arch rises to some position-dependent height at
 * or below that ceiling, so reserving the ceiling itself plus a margin covers
 * all of them regardless of how many pages are open.
 */
const CONNECTOR_ARC_BAND_PX = 240;

export const DesignerCanvas = memo(function DesignerCanvas({
  blocks,
  productsById,
  theme,
  header,
  previewMode,
  onPreviewModeChange,
  backgroundImageUrl = null,
  customFontUrl = null,
  elementUrls,
  showGrid = true,
  viewport,
  onMoveBlock,
  onResizeBlock,
  onRotateBlock,
  onEmptyCellClick,
  onAddProduct,
  selectedKeys,
  onSelectBlock,
  onSelectMany,
  activeHeaderLine = null,
  onSelectHeaderLine,
  editingHeaderLine = null,
  editingHeaderRange = null,
  onEditHeaderLine,
  onHeaderTextChange,
  onToggleHeaderFormat,
  onHeaderEditEnd,
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
  onSpotChange,
  onOpenSpotSetting,
  disableMarquee = false,
  openPages = [],
  onClosePage,
  storefrontId = "",
  storefrontName = "",
  productPage,
  shippingPolicy = {},
  seller = {},
}: {
  blocks: StorefrontBlock[];
  productsById: Map<string, Product>;
  theme: StorefrontTheme;
  /** Optional masthead (name + bio) rendered above the grid when shown. */
  header: StorefrontHeader;
  /** Desktop designs at natural size + zoom. Mobile previews fluid UNTIL a
   *  product page opens, at which point there is a "beside the board" to
   *  put it, so the board switches to the same pannable canvas desktop
   *  uses — just sized for a phone. */
  previewMode: PreviewDevice;
  /** Flips the mode. Owns the device switch's placement too: anchored above
   *  the board (pans/zooms with it) whenever the canvas is showing, since
   *  there is no board to anchor to once the mobile column has taken over. */
  onPreviewModeChange: (mode: PreviewDevice) => void;
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
   *  Only reaches a stage to write to while the canvas is showing (design
   *  view, or mobile preview with a page open). */
  viewport?: CanvasViewport;
  /** All callbacks are keyed by blockKey(block). */
  onMoveBlock: (key: string, x: number, y: number) => void;
  onResizeBlock: (key: string, placement: GridPlacement) => void;
  /** Tilt, in degrees. The block keeps the cells it had. */
  onRotateBlock: (key: string, rotation: number) => void;
  /** Clicking a free cell inserts there. */
  onEmptyCellClick: (x: number, y: number) => void;
  /** Opens the product picker. Drives the empty state's CTA; omitted in
   *  read-only renders, where there is nothing to add. */
  onAddProduct?: () => void;
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
  /** The masthead line whose words are being typed in place, if any. */
  editingHeaderLine?: HeaderLine | null;
  /** Where the caret goes when that editor opens (the double-clicked word). */
  editingHeaderRange?: TextRange | null;
  onEditHeaderLine?: (line: HeaderLine, range: TextRange | null) => void;
  onHeaderTextChange?: (line: HeaderLine, value: string) => void;
  onToggleHeaderFormat?: (
    line: HeaderLine,
    format: "bold" | "italic" | "underline",
  ) => void;
  onHeaderEditEnd?: () => void;
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
  /** Product tiles: the seller dragged (or arrowed) the title or the price to
   *  a new home. */
  onSpotChange?: (key: string, token: SpotToken, drop: SpotDrop) => void;
  /** Product tiles: the seller pressed the title or the price without moving
   *  it, which asks for the controls that shape it. */
  onOpenSpotSetting?: (key: string, token: SpotToken) => void;
  /** True while a pan tool owns frame drags (space held). */
  disableMarquee?: boolean;
  /**
   * Product ids whose page is open as an artboard beside the board, in the
   * order they were opened. A VIEW state of the editor: which pages the seller
   * has out is not part of the design and is never saved.
   */
  openPages?: readonly string[];
  /** Dismiss one page's artboard from its own close control. Opening one is
   *  the selection toolbar's business, not the canvas's. */
  onClosePage?: (productId: string) => void;
  storefrontId?: string;
  storefrontName?: string;
  /** The page's own design. Absent leaves the artboards unrendered. */
  productPage?: ProductPageConfig;
  /** The account's shipping and returns terms, read-only — the preview
   *  renders what they produce. See lib/settings/shipping-policy.ts. */
  shippingPolicy?: SellerShippingPolicy;
  seller?: StorefrontSeller;
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
    onFrameBlock,
    onFramePlacement,
    onFrameExit,
    onTypeStart,
    onTextChange,
    onToggleBlockFormat,
    onTextRangeChange,
    onTypeEnd,
    onSpotChange,
    onOpenSpotSetting,
    onSelectHeaderLine,
    onEditHeaderLine,
    onHeaderTextChange,
    onToggleHeaderFormat,
    onHeaderEditEnd,
    disableMarquee,
  });
  useEffect(() => {
    handlers.current = {
      onSelectBlock,
      onSelectMany,
      onFrameBlock,
      onFramePlacement,
      onFrameExit,
      onTypeStart,
      onTextChange,
      onToggleBlockFormat,
      onTextRangeChange,
      onTypeEnd,
      onSpotChange,
      onOpenSpotSetting,
      onSelectHeaderLine,
      onEditHeaderLine,
      onHeaderTextChange,
      onToggleHeaderFormat,
      onHeaderEditEnd,
      disableMarquee,
    };
  });
  const toggleSelection = useCallback((key: string, additive?: boolean) => {
    // Toggle semantics (deselect on re-click, add on shift) live with the
    // selection's owner, StorefrontDesigner.
    handlers.current.onSelectBlock(key, additive);
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
  const editHeaderLine = useCallback(
    (line: HeaderLine, range: TextRange | null) => {
      handlers.current.onEditHeaderLine?.(line, range);
    },
    [],
  );
  const changeHeaderText = useCallback((line: HeaderLine, value: string) => {
    handlers.current.onHeaderTextChange?.(line, value);
  }, []);
  const toggleHeaderFormat = useCallback(
    (line: HeaderLine, format: "bold" | "italic" | "underline") => {
      handlers.current.onToggleHeaderFormat?.(line, format);
    },
    [],
  );
  const endHeaderEdit = useCallback(() => {
    handlers.current.onHeaderEditEnd?.();
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
  const changeSpot = useCallback(
    (key: string, token: SpotToken, drop: SpotDrop) => {
      handlers.current.onSpotChange?.(key, token, drop);
    },
    [],
  );
  const openSpotSetting = useCallback((key: string, token: SpotToken) => {
    handlers.current.onOpenSpotSetting?.(key, token);
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

  /**
   * Alt+click reaches the block UNDER the one on top.
   *
   * Once blocks can be stacked, the topmost is the only one a plain click can
   * ever reach: it is the one that paints there, so it is the one the pointer
   * hits. Repeated Alt+clicks walk down through everything under the cursor
   * and then wrap, which is how Illustrator and Sketch have always done it,
   * and it is the alternative to making the seller send the top block away to
   * get at what is beneath it.
   *
   * `elementsFromPoint` is what makes it exact: it returns the real hit stack
   * in paint order, so a tilted block counts where it PAINTS rather than
   * wherever its bounding box happens to reach.
   */
  const stackClick = useRef(false);

  /** The blocks painting at a point, front to back. Shared by Alt+click and
   *  the touch tap-cycle below, both of which walk the same hit stack. */
  function blocksUnderPoint(clientX: number, clientY: number): string[] {
    const under: string[] = [];
    for (const element of document.elementsFromPoint(clientX, clientY)) {
      const key = (element as HTMLElement).closest?.<HTMLElement>(
        "[data-grid-key]",
      )?.dataset.gridKey;
      if (key && !under.includes(key)) under.push(key);
    }
    return under;
  }

  function selectThroughStack(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.altKey || event.button !== 0 || event.pointerType === "touch") {
      return;
    }
    const under = blocksUnderPoint(event.clientX, event.clientY);
    if (under.length === 0) return;
    // Own the whole press: no drag, and no click landing on the tile on top
    // and selecting it straight back.
    event.preventDefault();
    event.stopPropagation();
    stackClick.current = true;
    const current = selectedKeys.length === 1 ? under.indexOf(selectedKeys[0]) : -1;
    handlers.current.onSelectBlock(under[(current + 1) % under.length]);
  }

  /**
   * Touch has no Alt key, so repeatedly tapping the same spot is what walks
   * down a stack: each tap that lands on a point whose stack still contains
   * the current selection advances to the next block down, wrapping at the
   * bottom, exactly like repeated Alt+clicks. A tap whose stack does NOT
   * contain the current selection -- the first touch anywhere, or a tap on an
   * unrelated block -- is a plain select and must reach BlockTile's own click
   * handling untouched. A real drag is untouched too, since this only fires
   * on release and bails the moment the press has actually moved.
   *
   * Deferred to pointerup rather than intercepted on pointerdown the way
   * Alt+click is: pointerdown is also where Grid's own move gesture starts,
   * and a touch press cannot say yet whether it will become a drag.
   */
  const touchDownAt = useRef<{ x: number; y: number } | null>(null);

  function noteTouchStart(event: React.PointerEvent<HTMLDivElement>) {
    touchDownAt.current =
      event.pointerType === "touch"
        ? { x: event.clientX, y: event.clientY }
        : null;
  }

  function cycleStackOnTap(event: React.PointerEvent<HTMLDivElement>) {
    const down = touchDownAt.current;
    touchDownAt.current = null;
    if (event.pointerType !== "touch" || !down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;

    const under = blocksUnderPoint(event.clientX, event.clientY);
    if (under.length < 2) return;
    const current = selectedKeys.length === 1 ? under.indexOf(selectedKeys[0]) : -1;
    if (current === -1) return;

    event.stopPropagation();
    stackClick.current = true;
    handlers.current.onSelectBlock(under[(current + 1) % under.length]);
  }

  /** Swallow the click that follows a marquee drag or an Alt+click: in both
   *  cases the press has already been spent on selecting, and letting it
   *  through would insert a block or re-select the tile on top. */
  function suppressSyntheticClick(event: React.MouseEvent<HTMLDivElement>) {
    if (stackClick.current) {
      stackClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!marqueeDragged.current) return;
    marqueeDragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // Map storefront blocks -> generic grid blocks. Each carries its own
  // coordinates, so the array order means nothing.
  //
  // Depth is resolved ONCE here rather than per cell: layerOrder sorts the
  // whole board, and asking it per cell would sort a 120-block board 120 times
  // for every paint.
  const gridBlocks = useMemo<GridBlock<StorefrontBlock>[]>(() => {
    const depths = new Map(
      layerOrder(blocks).map((block, index) => [blockKey(block), index]),
    );
    return blocks.map((block) => {
      const key = blockKey(block);
      return {
        key,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        // Both visual only: the block still covers exactly the cells above, so
        // the grid's placement rules never see either of them.
        rotation: block.rotation,
        z: depths.get(key),
        data: block,
      };
    });
  }, [blocks]);

  // Whether this board is arranged in a way a straight line cannot express.
  // Cheap enough to run per render on a 120-block board, and it has to follow
  // the blocks, since one drag onto a neighbour is what changes the answer.
  const freelyArranged = useMemo(() => isFreelyArranged(blocks), [blocks]);

  // The design canvas renders at its natural size and is scaled; the mobile
  // preview simulates a real phone's width instead — fixed, not fluid, once
  // a page is open (see showCanvas below), so a seller comparing tile to
  // page sees them at the same believable scale rather than one shrinking to
  // fit whatever room is left.
  const isDesign = previewMode === "desktop";
  const desktopBoardWidth =
    theme.columns * DESIGN_CELL_PX +
    (theme.columns - 1) * theme.gridGap +
    DESIGN_FRAME_CHROME_PX;
  const boardWidth = isDesign ? desktopBoardWidth : MOBILE_PREVIEW_WIDTH;
  // What each open page's OWN desktop/mobile switch can choose between. NOT
  // the board's own two widths: a product page is a real, separate route a
  // buyer's browser renders on its own, not a panel scaled to match however
  // many grid columns the seller picked — mobile still borrows the board's
  // phone-width simulation (a real phone is a real phone either way), but
  // desktop needs its own realistic browser width so the page can actually
  // reach its image-left/details-right layout (see PRODUCT_PAGE_DESKTOP_WIDTH).
  const pageWidths: Record<PreviewDevice, number> = {
    desktop: PRODUCT_PAGE_DESKTOP_WIDTH,
    mobile: MOBILE_PREVIEW_WIDTH,
  };

  // The canvas font. An uploaded face is declared here as a custom property
  // and applied through it, so text blocks that opt into the same face inherit
  // it without every tile having to be handed a font URL.
  const canvasFont = fontPresentation(theme.font);

  // THE PAGES THE SELLER HAS OUT, as artboards beside the board — in design
  // view AND in mobile preview, the same way. A page whose product has left
  // the catalogue simply drops out, the same way a selection of a deleted
  // block does.
  const openProductIds = useMemo(
    () => (productPage ? openPages.filter((id) => productsById.has(id)) : []),
    [productPage, openPages, productsById],
  );

  // The tile's manual sold-out flag is live in the editor, so the page has to
  // read it from the board rather than from the snapshot it loaded.
  const soldOutProducts = useMemo(() => {
    const ids = new Set<string>();
    for (const block of blocks) {
      if (block.type === "product" && block.soldOut) ids.add(block.productId);
    }
    return ids;
  }, [blocks]);

  const artboards = productPage
    ? openProductIds.flatMap((id) => {
        const product = productsById.get(id);
        if (!product) return [];
        return [
          <ProductPageArtboard
            key={id}
            widths={pageWidths}
            initialDevice={previewMode}
            product={product}
            soldOut={soldOutProducts.has(id)}
            storefrontId={storefrontId}
            storefrontName={storefrontName}
            theme={theme}
            header={header}
            productPage={productPage}
            shippingPolicy={shippingPolicy}
            seller={seller}
            backgroundImageUrl={backgroundImageUrl}
            customFontUrl={customFontUrl}
            onClose={() => onClosePage?.(id)}
          />,
        ];
      })
    : [];

  // What can move either end of a line without the connectors hearing about
  // it: which pages are out, and where the tiles sit on the board.
  const connectorRevision = useMemo(
    () =>
      [
        openProductIds.join(","),
        theme.columns,
        theme.rows,
        theme.gridGap,
        blocks.map((block) => `${block.x},${block.y},${block.w},${block.h}`).join("|"),
      ].join("~"),
    [openProductIds, theme.columns, theme.rows, theme.gridGap, blocks],
  );

  const canvas = (
    <div
      ref={frameRef}
      // The storefront itself, as opposed to the chrome around it. Both the
      // connectors (which leave from its right-hand edge) and the workspace's
      // pan gesture (which must NOT start on it) ask for it by this name.
      data-canvas-board=""
      // Capture, so an Alt+press is claimed before the tile under it can turn
      // it into a drag or a selection of its own. noteTouchStart only
      // records; it never claims the press, so a touch drag still starts
      // normally underneath it.
      onPointerDownCapture={(event) => {
        selectThroughStack(event);
        noteTouchStart(event);
      }}
      onPointerUpCapture={cycleStackOnTap}
      onPointerDown={startMarquee}
      onClickCapture={suppressSyntheticClick}
      className={cn(
        // Relative: the marquee rubber band positions against this frame.
        // shadow-lg lifts the board off the workspace the same way
        // ProductPageArtboard's own frame does, so the two kinds of artboard
        // on this canvas read as the same sort of object.
        "relative rounded-md border border-border p-4 shadow-lg",
        canvasFont.className,
      )}
      // Schema-constrained: hex is re-gated by the strict regex, the gap is
      // a bounded integer. gridGapStyle sets the --grid-gap token the
      // .ss-grid rule inherits.
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
          // Above every block on the board, from the shared band rather than a
          // `z-40` class: a layered board can put a block at any depth in the
          // content range, and a rubber band drawn under one is invisible
          // exactly when it is being used.
          style={{ zIndex: OVERLAY_Z }}
          className="pointer-events-none absolute hidden border border-ring bg-ring/10"
        />
        <StorefrontMasthead
          header={header}
          theme={theme}
          activeLine={activeHeaderLine}
          onSelectLine={selectHeaderLine}
          editingLine={editingHeaderLine}
          editingRange={editingHeaderRange}
          onEditLine={editHeaderLine}
          onLineTextChange={changeHeaderText}
          onToggleLineFormat={toggleHeaderFormat}
          onEditDone={endHeaderEdit}
        />

        {blocks.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-sm border border-dashed border-border bg-background/60 p-6 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-border bg-background shadow-xs">
              <ShoppingBag
                className="size-5 text-muted-foreground"
                strokeWidth={2}
                aria-hidden="true"
              />
            </div>
            <p className="text-sm font-medium text-foreground">
              Your grid is empty
            </p>
            <p className="mt-1 max-w-xs font-inter text-sm text-muted-foreground">
              Add a product to start arranging your storefront. Text and
              shapes are on the toolbar below.
            </p>
            {onAddProduct && (
              <button
                type="button"
                suppressHydrationWarning
                onClick={onAddProduct}
                className={`mt-4 ${primaryButtonClass}`}
              >
                <ShoppingBag
                  className={`size-4 ${iconPopClass}`}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Add product
              </button>
            )}
          </div>
        ) : (
          <Grid
            editable
            // Stacking is a design move here, not a mistake: a drop onto an
            // occupied cell lands on top of it instead of springing back, and
            // the Layer controls decide which one paints over the other.
            allowOverlap
            showEmptyCells={showGrid}
            blocks={gridBlocks}
            ariaLabel="Storefront canvas"
            columns={theme.columns}
            rows={theme.rows}
            // A board with a tilt or a stack on it has no honest narrow-screen
            // repacking: pulling a word off the shape it sits on and setting
            // the two side by side is a different design, not a smaller one.
            // Such a board keeps its columns and its cells simply get smaller.
            responsive={!freelyArranged}
            // Corner roundness drives the cell clip (style beats the grid's
            // default rounded-sm class); tiles inherit it, no clip of their
            // own. Scaled per tile size so big tiles round like small ones.
            // Per block: a product tile may override the theme's roundness.
            cellStyle={(placement, gridBlock) => ({
              ...tileClipStyle(
                scaledCornerRadius(
                  gridBlock
                    ? blockCornerRadius(theme, gridBlock.data)
                    : theme.cornerRadius,
                  placement,
                ),
              ),
              // A tile being framed draws the rest of its picture OUTSIDE
              // itself, and any block in front would paint straight over it.
              // Lifting the cell clear of the whole content band is what keeps
              // the spill visible, including from the back of a deep stack.
              ...(gridBlock && framingKey === gridBlock.key
                ? { zIndex: FRAME_Z }
                : {}),
            })}
            getBlockLabel={(gridBlock) =>
              blockLabel(gridBlock.data, productFor(gridBlock.data))
            }
            onMove={onMoveBlock}
            onResize={onResizeBlock}
            onRotate={onRotateBlock}
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
                onFrame={frameByKey}
                onFramePlacement={placeFrame}
                onFrameExit={exitFrame}
                onTypeStart={startTyping}
                onTextChange={changeText}
                onToggleBlockFormat={toggleBlockFormat}
                onTextRangeChange={changeTextRange}
                onTypeEnd={endTyping}
                onSpotChange={changeSpot}
                onOpenSpotSetting={openSpotSetting}
              />
            )}
          />
        )}
    </div>
  );

  // A page open beside the board needs somewhere to actually go, which the
  // plain scrolling column mobile preview otherwise doesn't have — so
  // opening one switches mobile preview onto the very same pannable canvas
  // design view already uses, sized for a phone instead of a desktop. With
  // nothing open, mobile preview stays the fluid single column that reflows
  // exactly as a real phone would.
  const showCanvas = isDesign || artboards.length > 0;

  // Mobile preview, nothing open: a phone-width column, fluid, so the grid
  // reflows exactly as it will on a real device. No stage here to ride along
  // with (nothing pans or zooms in this mode), but the switch still belongs
  // to the column itself, not to the app chrome around it — same treatment
  // as the canvas's own switch (see Stage below): a row above the frame,
  // scrolling with it rather than floating fixed over the editor.
  if (!showCanvas) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
        <div className="flex items-center justify-end">
          <DeviceSizeSwitch
            device={previewMode}
            onChange={onPreviewModeChange}
            labels={{ desktop: "Desktop preview", mobile: "Mobile preview" }}
          />
        </div>
        {canvas}
      </div>
    );
  }

  return (
    <Stage
      viewport={viewport}
      boardWidth={boardWidth}
      canvas={canvas}
      artboards={artboards}
      pageLinks={openProductIds}
      connectorRevision={connectorRevision}
      previewMode={previewMode}
      onPreviewModeChange={onPreviewModeChange}
    />
  );
});

/**
 * The workspace the board floats on, and everything else that floats with it.
 *
 * Its own component because it owns the stage NODE: the viewport writes the
 * pan/zoom transform straight to that element every frame (see
 * useCanvasViewport), so panning never re-renders the canvas, and the
 * connectors need the same element to measure both ends of a line against.
 *
 * Content-sized, not board-sized: a page opening beside the board grows the
 * stage, and measureView (which centres and fits the view) reads that growth
 * for free.
 */
function Stage({
  viewport,
  boardWidth,
  canvas,
  artboards,
  pageLinks,
  connectorRevision,
  previewMode,
  onPreviewModeChange,
}: {
  viewport?: CanvasViewport;
  /** The board's current width — its natural design-view size, or the fixed
   *  phone width mobile preview simulates. Every open page gets handed this
   *  same number, so a page never renders at a different scale than the
   *  board it belongs to. */
  boardWidth: number;
  canvas: ReactNode;
  artboards: ReactNode[];
  /** Product ids of the open pages, in artboard order. */
  pageLinks: readonly string[];
  connectorRevision: string;
  previewMode: PreviewDevice;
  onPreviewModeChange: (mode: PreviewDevice) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const registerStage = useCallback(
    (node: HTMLDivElement | null) => {
      stageRef.current = node;
      viewport?.registerStage(node);
    },
    [viewport],
  );

  return (
    <div
      ref={registerStage}
      data-canvas-stage=""
      style={{
        width: "max-content",
        transformOrigin: "0 0",
        // Promote the stage to its own compositor layer up front, so a pan is
        // a GPU transform rather than a repaint of every tile.
        willChange: "transform",
        // Reserved above BOTH the board and the pages, not just the pages, so
        // the two start level with each other: a page reads as belonging to
        // the storefront it opened from, not as a separate thing hanging
        // lower on the workspace. It's also the room each connector's arc
        // gets to rise into (see CONNECTOR_ARC_BAND_PX): reserving it here,
        // as real layout space, is what keeps the arc inside the box Fit
        // measures, so fitting the canvas never crops one off the top.
        paddingTop: CONNECTOR_ARC_BAND_PX,
      }}
      className="absolute left-0 top-0 flex items-start gap-24"
    >
      {/* First child, so the lines paint UNDER the board and the pages. */}
      <PageConnectors stageRef={stageRef} links={pageLinks} revision={connectorRevision} />
      <div className="flex flex-col gap-2" style={{ width: boardWidth }}>
        {/* Same chrome as the product page artboard's own frame label (see
            ProductPageArtboard): a row OUTSIDE the board, riding the same
            transform, so the switch pans and zooms with it instead of
            floating apart from the thing it controls. */}
        <div className="flex items-center justify-end">
          <DeviceSizeSwitch
            device={previewMode}
            onChange={onPreviewModeChange}
            labels={{ desktop: "Desktop preview", mobile: "Mobile preview" }}
          />
        </div>
        {canvas}
      </div>
      {/* PAGES SIDE BY SIDE, never stacked. Two pages under one another put
          the second one a whole page-height down the workspace, where nothing
          about the board is on screen any more; in a row they stay at the
          board's own eye level, and panning right walks through them. */}
      {artboards.length > 0 && (
        <div className="flex items-start gap-24">{artboards}</div>
      )}
    </div>
  );
}
