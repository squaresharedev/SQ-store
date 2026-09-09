"use client";

/**
 * Figma-style floating toolbar fixed at the bottom-center of the storefront
 * designer: insert tools, history, zoom. The desktop/mobile preview switch
 * lives separately, floating above the canvas (see DeviceSizeSwitch) — it is
 * reachable at every viewport width, so it has no seat in this bar at all.
 *
 * PHONES GET A DIFFERENT BAR. The full set is ~570px wide, so below `sm` it
 * used to overflow a 390px screen and silently clip everything past the zoom
 * readout — including the Design button, which is the ONLY way to reach global
 * settings on mobile. Rather than let it scroll (a primary action nobody would
 * find), the bar is split by priority:
 *
 *   phone : insert · undo · Design · More
 *   sm+   : the full bar
 *
 * "More" holds what a thumb rarely needs mid-edit — redo and tidy.
 * Zoom buttons are desktop-only: pinch handles it on touch, far better than
 * a pair of 36px targets.
 *
 * z-40 - intentionally sits below modals/sheets (z-50) so a panel opening
 * over the canvas does not fight for the same layer.
 *
 * AND IT GETS OUT OF THE WAY. Below `lg` the panels are bottom sheets drawn on
 * exactly the strip this bar floats over, so while one is open the bar is not a
 * toolbar over a canvas but a pill sitting on top of the sheet's own controls.
 * `sheetOpen` takes it off screen for as long as that lasts; the sheet's close
 * button is what brings it back. On lg+ the panels are columns and cover
 * nothing, so the flag is ignored there.
 */

import { useEffect, useRef, useState } from "react";
import {
  Ellipsis,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  Redo2,
  Shapes,
  ShoppingBag,
  SlidersHorizontal,
  Type,
  Undo2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { type ShapeKind } from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  focusRingClass as FOCUS_RING,
  iconPopClass,
  overlayItemClass,
  overlaySurfaceClass,
  toolbarTipClass,
  transitionClass as TRANSITION,
} from "@/components/ui/control-styles";
import { ShapeKindGlyph } from "./ShapeTileContent";
import { QUICK_SHAPE_KINDS, SHAPE_SPECS } from "./shape-specs";

/**
 * What the file dialog offers. Extensions alongside the MIME types because
 * browsers report SVG inconsistently — a filter of `image/svg+xml` alone can
 * grey out the very .svg the seller is trying to pick.
 */
const ELEMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml,.svg";
import { useZoomValue, type CanvasViewport } from "./useCanvasViewport";

/** The live zoom percentage. Its own component so that subscribing to the
 *  viewport re-renders this text alone. */
function ZoomReadout({ viewport }: { viewport: CanvasViewport }) {
  return <>{Math.round(useZoomValue(viewport) * 100)}%</>;
}

/** Labelled insert-tool button: icon + text label (label hidden on mobile).
 *  `group/btn` lets the icon pop on hover/focus (see iconPopClass below);
 *  `group/tip relative` hosts a <ToolbarTip> child. */
const INSERT_BTN =
  `group/btn group/tip relative inline-flex h-11 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs font-medium sm:h-9 ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** The insert tools' icons all share the additive "pop" microinteraction. */
const INSERT_ICON = `size-4 ${iconPopClass}`;

const ICON_BTN_BASE =
  `group/tip relative inline-flex shrink-0 items-center justify-center rounded-none sm:size-9 ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Icon-only square button. 44px on touch (the Apple/Material minimum), 36px
 *  from `sm` up where a pointer makes the smaller target fine. */
const ICON_BTN = `size-11 ${ICON_BTN_BASE}`;

/** The same button, NARROWED ON A PHONE: still 44px tall, but 36px wide.
 *
 *  The bar is a `shrink-0` row inside a `max-w-[calc(100vw-2rem)]` pill, which
 *  means it does not fit so much as overflow, and what hangs out of the right
 *  edge is whatever is last: the More button, drawn outside the surface it is
 *  supposed to be part of. It cleared an iPhone 13's 390px by 18px and missed a
 *  360px Android by 12, which is a bar that fits by luck.
 *
 *  Only the two phone-only controls at the right end wear this. Height is what
 *  a thumb actually aims with on a row of controls this size, so keeping 44
 *  there and spending the width is the cheap half of the trade; the icon is
 *  unchanged at 16px, and 36px wide matches the insert buttons beside them. */
const NARROW_ICON_BTN = `h-11 w-9 ${ICON_BTN_BASE}`;

/** Row inside the "More" sheet: the shared overlay row, a little roomier. */
const MORE_ITEM = cn(overlayItemClass, "gap-3 py-2.5 font-medium");

/** Labelled button inside the single-row Element menu. Matches the toolbar's
 *  own insert buttons rather than the "More" sheet's rows, because it sits in
 *  a horizontal bar, not a vertical list. */
const MENU_ROW_BTN =
  `group/tip relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs font-medium ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Hover/focus label popped above an icon-only (or icon+hidden-label)
 *  toolbar control. Its host button supplies the `group/tip` this reacts to
 *  — see toolbarTipClass. Visual only: the trigger's own `aria-label` is
 *  already the accessible name, so this stays out of the a11y tree. */
function ToolbarTip({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className={toolbarTipClass}>
      {children}
    </span>
  );
}

/** Active state for the preview-mode pair. */
const PREVIEW_ACTIVE = "bg-primary text-primary-foreground";
/** Idle state for the preview-mode pair. */
const PREVIEW_IDLE =
  `text-muted-foreground hover:bg-accent hover:text-foreground`;

/** Thin vertical divider between toolbar groups. */
function Divider() {
  return (
    <div
      aria-hidden="true"
      className="mx-1 h-6 w-px shrink-0 bg-border"
    />
  );
}

export function EditorToolbar({
  onAddProduct,
  onAddText,
  onAddShape,
  onAddElement,
  onOpenShapesPanel,
  uploadingElement = false,
  canAddBlocks,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  viewport,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onTidy,
  canTidy,
  settingsOpen,
  onToggleSettings,
  sheetOpen = false,
  pagesOpen,
  canOpenPage,
  onTogglePages,
}: {
  /** True while at least one product page is out on the canvas. */
  pagesOpen: boolean;
  /** False when the board holds no product, so there is no page to show. */
  canOpenPage: boolean;
  /** Show the page for the selected (or first) product, or put them all away. */
  onTogglePages: () => void;
  onAddProduct: () => void;   // opens the product picker card (does not insert directly)
  onAddText: () => void;
  /** Insert a shape of the given kind (chosen from the hover menu). */
  onAddShape: (kind: ShapeKind) => void;
  /** Upload the seller's own artwork and insert it as an image block. The
   *  designer owns the upload, so failures surface as its toasts. */
  onAddElement: (file: File) => void;
  /** Open the left panel on the full shape library. */
  onOpenShapesPanel: () => void;
  /** True while an element upload is in flight. */
  uploadingElement?: boolean;
  canAddBlocks: boolean;      // false when the block cap is reached -> disable the insert tools
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Live pan + zoom. Only the readout subscribes, so a gesture re-renders
   *  a single <span> rather than the toolbar (let alone the canvas). */
  viewport: CanvasViewport;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** Pack every block toward the top-left, in reading order. */
  onTidy: () => void;
  canTidy: boolean;
  /** Mobile only: the Design bottom sheet (global settings) toggle. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  /** Mobile only: a panel is open as a bottom sheet over this bar's own strip,
   *  so the bar stands down until it closes. */
  sheetOpen?: boolean;
}) {
  // Touch/click fallback for the shape menu (hover has no meaning there).
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  // Phone-only overflow menu (see the file header for what lands in it).
  const [moreOpen, setMoreOpen] = useState(false);
  const shapeRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  // The element picker, driven by the menu's Upload row.
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Tap away (or press Esc) to dismiss either menu.
   *
   * Deliberately a document listener rather than a full-screen backdrop
   * element: the toolbar is centred with `-translate-x-1/2`, and a transformed
   * ancestor becomes the containing block for `position: fixed` children — so
   * a `fixed inset-0` backdrop nested in here covers the TOOLBAR, not the
   * viewport, and taps on the canvas sail straight past it.
   *
   * Capture phase, because the canvas stops propagation on pointerdown to keep
   * a resize gesture from also starting a move.
   */
  useEffect(() => {
    if (!shapeMenuOpen && !moreOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!shapeRef.current?.contains(target)) setShapeMenuOpen(false);
      if (!moreRef.current?.contains(target)) setMoreOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setShapeMenuOpen(false);
      setMoreOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shapeMenuOpen, moreOpen]);

  // A sheet opening over the bar takes its menus with it: reopening the bar
  // later onto a menu nobody asked for would be a menu with no press behind it.
  // Adjusted during render rather than in an effect (the pattern DesignPanel
  // uses for the same shape of problem) so the bar never paints a frame of the
  // menu on its way back.
  const [barWasCovered, setBarWasCovered] = useState(sheetOpen);
  if (sheetOpen !== barWasCovered) {
    setBarWasCovered(sheetOpen);
    if (sheetOpen) {
      setShapeMenuOpen(false);
      setMoreOpen(false);
    }
  }

  return (
    // Display-only wrapper, and a wrapper rather than a class on the bar
    // itself: the bar's own class list already sets `flex`, and two display
    // utilities of equal specificity are settled by stylesheet order rather
    // than class order (see the Redo/Tidy group below for the same trap).
    // Hiding the PARENT is decided by one class and cannot be out-ordered.
    <div className={sheetOpen ? "hidden lg:contents" : "contents"}>
    <div
      role="toolbar"
      aria-label="Editor tools"
      // No overflow clipping here: the shape menu pops out above the bar.
      className={cn(
        overlaySurfaceClass,
        "fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex max-w-[calc(100vw-2rem)] items-center gap-1 bg-background/95 p-1.5 backdrop-blur",
      )}
    >
      {/* -- Group 1: INSERT tools -- */}
      <button
        type="button"
        suppressHydrationWarning
        className={INSERT_BTN}
        onClick={onAddProduct}
        disabled={!canAddBlocks}
        aria-label="Add product"
      >
        <ShoppingBag className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Product</span>
        <ToolbarTip>Add product</ToolbarTip>
      </button>

      <button
        type="button"
        suppressHydrationWarning
        className={INSERT_BTN}
        onClick={onAddText}
        disabled={!canAddBlocks}
        aria-label="Add text"
      >
        <Type className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Text</span>
        <ToolbarTip>Add text</ToolbarTip>
      </button>

      {/* Element tool: hovering (or clicking, on touch) reveals the menu —
          upload your own artwork, or drop in one of the common shapes. The
          full library lives in the left panel, one click away. */}
      <div
        ref={shapeRef}
        className="group/shape relative"
        onMouseLeave={() => setShapeMenuOpen(false)}
      >
        <button
          type="button"
          suppressHydrationWarning
          className={INSERT_BTN}
          onClick={() => setShapeMenuOpen((open) => !open)}
          disabled={!canAddBlocks}
          aria-label="Add element"
          aria-haspopup="true"
          aria-expanded={shapeMenuOpen}
        >
          <Shapes className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
          <span className="hidden sm:inline">Element</span>
          {/* NO ToolbarTip here, alone among the insert tools. Tips pop ABOVE
              the bar, and so does this button's own menu, which opens on the
              same hover, is far bigger, and is drawn on top. The tip was a
              label nobody could ever read, announcing a menu already on
              screen. The button keeps its aria-label. */}
        </button>

        {/* pb-1.5 (not a margin) bridges the visual gap between button and
            menu, so hover never drops while the pointer crosses it. */}
        <div
          data-element-menu=""
          className={cn(
            // w-max is load-bearing. This is absolutely positioned, and an
            // abspos box's shrink-to-fit width is capped by its containing
            // block — here the Element BUTTON's wrapper, barely 100px wide. So
            // the row was quietly squeezed and the last shape overflowed past
            // the border by ~11px. max-content sizes it to the items instead.
            "absolute bottom-full left-1/2 z-50 w-max -translate-x-1/2 pb-1.5",
            // ON A PHONE IT CENTRES ON THE BAR, NOT ON THE BUTTON. The row is
            // ~265px wide and Element is the third of eight controls, so
            // centring it on that button put its left edge at roughly x=-4 on a
            // 390px screen: the Upload button sat half off the side of the
            // display, which is exactly where a right thumb cannot reach.
            //
            // `fixed` is what re-centres it, and it works here for the same
            // reason a `fixed inset-0` backdrop does NOT (see the dismiss
            // effect above): the toolbar is transformed, so it, not the
            // viewport, is the containing block for fixed descendants.
            // `inset-x-0` therefore spans the BAR, which is itself centred and
            // capped at `100vw-2rem`, so the menu is centred on screen and
            // cannot reach an edge at any phone width. `bottom-full` still
            // means "sit on top of it", and pb-1.5 still bridges the hover gap.
            "max-sm:fixed max-sm:inset-x-0 max-sm:w-auto max-sm:translate-x-0 max-sm:flex max-sm:justify-center",
            "transition-opacity duration-base ease-standard motion-reduce:transition-none",
            shapeMenuOpen
              ? "visible opacity-100"
              : "invisible opacity-0 group-hover/shape:visible group-hover/shape:opacity-100 group-focus-within/shape:visible group-focus-within/shape:opacity-100",
          )}
        >
          {/* ONE ROW, and deliberately so. This started as the whole 22-shape
              library and scrolled sideways; the library now lives in the left
              panel, which leaves exactly four things worth reaching for
              without travelling: upload, the library, and the two shapes
              nobody wants to open a panel for. */}
          <div
            role="menu"
            aria-label="Elements"
            className={cn(
              overlaySurfaceClass,
              // shrink-0 for the phone case above, where this row is a flex
              // ITEM: its own buttons never shrink, so letting the pill shrink
              // would only pull its right border in over the last shape.
              "flex shrink-0 items-center gap-1 bg-background/95 p-1.5 backdrop-blur",
            )}
          >
            {/* Upload leads: it is the reason this tool is called Element.
                ICON ONLY — its label was the widest thing in the row and
                pushed the last shape past the edge. The icon is the universal
                one and the tooltip carries the detail, so nothing is lost. */}
            <button
              type="button"
              suppressHydrationWarning
              role="menuitem"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAddBlocks || uploadingElement}
              aria-label={uploadingElement ? "Uploading…" : "Upload"}
              aria-busy={uploadingElement}
              className={cn(ICON_BTN, "shrink-0")}
            >
              {/* The one place the row still needs words is progress, and an
                  icon-only button has none — so the icon itself spins. */}
              {uploadingElement ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              ) : (
                <Upload className="size-4" strokeWidth={2} aria-hidden="true" />
              )}
              <ToolbarTip>
                {uploadingElement ? "Uploading…" : "Upload image"}
              </ToolbarTip>
            </button>

            <button
              type="button"
              suppressHydrationWarning
              role="menuitem"
              onClick={() => {
                onOpenShapesPanel();
                setShapeMenuOpen(false);
              }}
              title="Browse the full shape library"
              className={MENU_ROW_BTN}
            >
              <Shapes className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              All shapes
            </button>

            <div aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-border" />

            {QUICK_SHAPE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                suppressHydrationWarning
                role="menuitem"
                onClick={() => {
                  onAddShape(kind);
                  setShapeMenuOpen(false);
                }}
                disabled={!canAddBlocks}
                aria-label={`Add ${SHAPE_SPECS[kind].label.toLowerCase()}`}
                className={cn(ICON_BTN, "shrink-0")}
              >
                <ShapeKindGlyph kind={kind} />
                <ToolbarTip>{SHAPE_SPECS[kind].label}</ToolbarTip>
              </button>
            ))}
          </div>
        </div>

        {/* Outside the menu on purpose: the menu unmounts its hover state as
            soon as the file dialog takes focus, and an input inside it would
            go with it before `change` ever fired. */}
        {/* aria-hidden keeps it out of the AT tree: the visible menu item is
            the labelled affordance, and this input is the implementation
            detail that item programmatically clicks. Same treatment as the
            other three hidden pickers (UploadsPanel, TypographySection,
            BackgroundEditor); an unlabelled file input is an axe failure. */}
        <input
          ref={fileInputRef}
          type="file"
          suppressHydrationWarning
          accept={ELEMENT_ACCEPT}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Clear first: picking the SAME file twice fires no `change` at
            // all unless the value is reset, so a failed upload could not be
            // retried with the same file.
            event.target.value = "";
            if (!file) return;
            setShapeMenuOpen(false);
            onAddElement(file);
          }}
        />
      </div>

      {/* -- The PRODUCT PAGE node. Sits with the insert tools because that is
            what it does: it puts another thing on the canvas. The tiles have
            their own node (see BlockTile); this is the route in when nothing
            is selected. -- */}
      <button
        type="button"
        suppressHydrationWarning
        className={`${INSERT_BTN} ${pagesOpen ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
        onClick={onTogglePages}
        disabled={!canOpenPage && !pagesOpen}
        aria-pressed={pagesOpen}
        aria-label={pagesOpen ? "Close the product pages" : "Show the product page"}
      >
        <FileText className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Page</span>
        <ToolbarTip>{pagesOpen ? "Close product page" : "Show product page"}</ToolbarTip>
      </button>

      <Divider />

      {/* -- Group 2: HISTORY -- */}
      <button
        type="button"
        suppressHydrationWarning
        className={ICON_BTN}
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
      >
        <Undo2 className="size-4" strokeWidth={2} aria-hidden="true" />
        <ToolbarTip>Undo (Ctrl+Z)</ToolbarTip>
      </button>

      {/* Redo and Tidy move into "More" on a phone — a thumb mid-edit reaches
          for undo far more often than either.
          Hidden via a WRAPPER, not `hidden sm:inline-flex` on the buttons:
          ICON_BTN already sets `inline-flex`, and two display utilities of
          equal specificity are settled by stylesheet order, not class order —
          `inline-flex` wins and the buttons never hide. */}
      <div className="hidden items-center gap-1 sm:flex">
        <button
          type="button"
          suppressHydrationWarning
          className={ICON_BTN}
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
        >
          <Redo2 className="size-4" strokeWidth={2} aria-hidden="true" />
          <ToolbarTip>Redo (Ctrl+Shift+Z)</ToolbarTip>
        </button>

        <button
          type="button"
          suppressHydrationWarning
          className={ICON_BTN}
          onClick={onTidy}
          disabled={!canTidy}
          aria-label="Tidy the canvas"
        >
          <WandSparkles className="size-4" strokeWidth={2} aria-hidden="true" />
          <ToolbarTip>Tidy up</ToolbarTip>
        </button>
      </div>

      {/* -- Group 3: ZOOM. The percentage doubles as "reset to 100%".
            Pointer-only: on touch, pinching the canvas is the zoom control. -- */}
      <div className="hidden items-center gap-1 sm:flex">
        <Divider />
        <button
          type="button"
          suppressHydrationWarning
          className={ICON_BTN}
          onClick={onZoomOut}
          aria-label="Zoom out"
        >
          <Minus className="size-4" strokeWidth={2} aria-hidden="true" />
          <ToolbarTip>Zoom out (Ctrl -)</ToolbarTip>
        </button>
        <button
          type="button"
          suppressHydrationWarning
          onClick={onZoomReset}
          aria-label="Reset zoom to 100%"
          className={`${INSERT_BTN} min-w-14 justify-center tabular-nums`}
        >
          <ZoomReadout viewport={viewport} />
          <ToolbarTip>Reset zoom (Ctrl 0)</ToolbarTip>
        </button>
        <button
          type="button"
          suppressHydrationWarning
          className={ICON_BTN}
          onClick={onZoomIn}
          aria-label="Zoom in"
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          <ToolbarTip>Zoom in (Ctrl +)</ToolbarTip>
        </button>
      </div>

      {/* -- Groups 5 and 6: the small-screen tail, and ONE group rather than
            two. Design settings (on a phone the only route to them) and the
            overflow menu are both phone-side controls sitting after the same
            divider, and the toolbar's own `gap-1` between them was 4px spent
            separating a pair that belongs together, and spent at the exact
            end of the row that was hanging out of the pill. They sit
            flush now, which reads as the pair they are and, with the narrower
            buttons, is what brings the row back inside its surface. -- */}
      <div className="flex items-center lg:hidden">
        <Divider />
        <button
          type="button"
          suppressHydrationWarning
          className={`${NARROW_ICON_BTN} ${settingsOpen ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
          onClick={onToggleSettings}
          aria-pressed={settingsOpen}
          aria-label="Design settings"
        >
          <SlidersHorizontal
            className="size-4"
            strokeWidth={2}
            aria-hidden="true"
          />
          <ToolbarTip>Design settings</ToolbarTip>
        </button>

      {/* Phone only: everything the bar had to give up. */}
      <div ref={moreRef} className="relative sm:hidden">
        <button
          type="button"
          suppressHydrationWarning
          className={`${NARROW_ICON_BTN} ${moreOpen ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
          onClick={() => setMoreOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More tools"
        >
          <Ellipsis className="size-4" strokeWidth={2} aria-hidden="true" />
          <ToolbarTip>More tools</ToolbarTip>
        </button>

        {moreOpen && (
          <div
            role="menu"
            aria-label="More tools"
            className={cn(
              overlaySurfaceClass,
              "absolute bottom-full right-0 z-50 mb-2 w-52 p-1",
            )}
          >
              <button
                type="button"
                suppressHydrationWarning
                role="menuitem"
                className={MORE_ITEM}
                onClick={() => {
                  onRedo();
                  setMoreOpen(false);
                }}
                disabled={!canRedo}
              >
                <Redo2 className="size-4" strokeWidth={2} aria-hidden="true" />
                Redo
              </button>
              <button
                type="button"
                suppressHydrationWarning
                role="menuitem"
                className={MORE_ITEM}
                onClick={() => {
                  onTidy();
                  setMoreOpen(false);
                }}
                disabled={!canTidy}
              >
                <WandSparkles className="size-4" strokeWidth={2} aria-hidden="true" />
                Tidy up
              </button>
              <button
                type="button"
                suppressHydrationWarning
                role="menuitem"
                className={MORE_ITEM}
                onClick={() => {
                  onZoomReset();
                  setMoreOpen(false);
                }}
              >
                <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
                Reset zoom
              </button>
              {/* NO "All shapes" row. It was here because the Element menu
                  opened on HOVER, which a thumb does not do. But that button
                  takes a press as well, and the menu it opens leads to the
                  same panel in one tap instead of two. A second route to one
                  place, inside a menu whose whole reason for existing is that
                  the bar has no room, was the row paying rent twice. */}
          </div>
        )}
        </div>
      </div>
    </div>
    </div>
  );
}
