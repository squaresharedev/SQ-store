"use client";

/**
 * Figma-style floating toolbar fixed at the bottom-center of the storefront
 * designer: insert tools, history, zoom, preview mode.
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
 * "More" holds what a thumb rarely needs mid-edit — redo, tidy, preview mode.
 * Zoom buttons are desktop-only: pinch handles it on touch, far better than
 * a pair of 36px targets.
 *
 * z-40 - intentionally sits below modals/sheets (z-50) so a panel opening
 * over the canvas does not fight for the same layer.
 */

import { useEffect, useRef, useState } from "react";
import {
  Ellipsis,
  Minus,
  Monitor,
  Plus,
  Redo2,
  Shapes,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
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
 *  `group/btn` lets the icon pop on hover/focus (see iconPopClass below). */
const INSERT_BTN =
  `group/btn inline-flex h-11 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs font-medium sm:h-9 ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** The insert tools' icons all share the additive "pop" microinteraction. */
const INSERT_ICON = `size-4 ${iconPopClass}`;

/** Icon-only square button. 44px on touch (the Apple/Material minimum), 36px
 *  from `sm` up where a pointer makes the smaller target fine. */
const ICON_BTN =
  `inline-flex size-11 shrink-0 items-center justify-center rounded-none sm:size-9 ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** Row inside the "More" sheet: the shared overlay row, a little roomier. */
const MORE_ITEM = cn(overlayItemClass, "gap-3 py-2.5 font-medium");

/** Labelled button inside the single-row Element menu. Matches the toolbar's
 *  own insert buttons rather than the "More" sheet's rows, because it sits in
 *  a horizontal bar, not a vertical list. */
const MENU_ROW_BTN =
  `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs font-medium ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

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
  previewMode,
  onPreviewModeChange,
  settingsOpen,
  onToggleSettings,
}: {
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
  previewMode: "desktop" | "mobile";
  onPreviewModeChange: (mode: "desktop" | "mobile") => void;
  /** Mobile only: the Design bottom sheet (global settings) toggle. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
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

  return (
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
        className={INSERT_BTN}
        onClick={onAddProduct}
        disabled={!canAddBlocks}
        aria-label="Add product"
        title="Add product"
      >
        <ShoppingBag className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Product</span>
      </button>

      <button
        type="button"
        className={INSERT_BTN}
        onClick={onAddText}
        disabled={!canAddBlocks}
        aria-label="Add text"
        title="Add text"
      >
        <Type className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Text</span>
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
          className={INSERT_BTN}
          onClick={() => setShapeMenuOpen((open) => !open)}
          disabled={!canAddBlocks}
          aria-label="Add element"
          aria-haspopup="true"
          aria-expanded={shapeMenuOpen}
          title="Add element: your own image, or a shape"
        >
          <Shapes className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
          <span className="hidden sm:inline">Element</span>
        </button>

        {/* pb-1.5 (not a margin) bridges the visual gap between button and
            menu, so hover never drops while the pointer crosses it. */}
        <div
          className={cn(
            "absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-1.5",
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
              "flex items-center gap-1 bg-background/95 p-1.5 backdrop-blur",
            )}
          >
            {/* Upload leads: it is the reason this tool is called Element. */}
            <button
              type="button"
              role="menuitem"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAddBlocks || uploadingElement}
              title="Upload an SVG, PNG or JPEG (up to 2 MB)"
              className={MENU_ROW_BTN}
            >
              <Upload className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {uploadingElement ? "Uploading…" : "Upload"}
            </button>

            <button
              type="button"
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
                role="menuitem"
                onClick={() => {
                  onAddShape(kind);
                  setShapeMenuOpen(false);
                }}
                disabled={!canAddBlocks}
                aria-label={`Add ${SHAPE_SPECS[kind].label.toLowerCase()}`}
                title={SHAPE_SPECS[kind].label}
                className={cn(ICON_BTN, "shrink-0")}
              >
                <ShapeKindGlyph kind={kind} />
              </button>
            ))}
          </div>
        </div>

        {/* Outside the menu on purpose: the menu unmounts its hover state as
            soon as the file dialog takes focus, and an input inside it would
            go with it before `change` ever fired. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ELEMENT_ACCEPT}
          className="sr-only"
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

      <Divider />

      {/* -- Group 2: HISTORY -- */}
      <button
        type="button"
        className={ICON_BTN}
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="size-4" strokeWidth={2} aria-hidden="true" />
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
          className={ICON_BTN}
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={ICON_BTN}
          onClick={onTidy}
          disabled={!canTidy}
          aria-label="Tidy the canvas"
          title="Tidy: pack blocks to the top-left"
        >
          <WandSparkles className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* -- Group 3: ZOOM. The percentage doubles as "reset to 100%".
            Pointer-only: on touch, pinching the canvas is the zoom control. -- */}
      <div className="hidden items-center gap-1 sm:flex">
        <Divider />
        <button
          type="button"
          className={ICON_BTN}
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out (Ctrl -)"
        >
          <Minus className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onZoomReset}
          aria-label="Reset zoom to 100%"
          title="Reset zoom (Ctrl 0)"
          className={`${INSERT_BTN} min-w-14 justify-center tabular-nums`}
        >
          <ZoomReadout viewport={viewport} />
        </button>
        <button
          type="button"
          className={ICON_BTN}
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in (Ctrl +)"
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* -- Group 4: PREVIEW mode -- */}
      <div className="hidden items-center gap-1 sm:flex">
        <Divider />
        <button
          type="button"
          className={`${ICON_BTN} ${previewMode === "desktop" ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
          onClick={() => onPreviewModeChange("desktop")}
          aria-pressed={previewMode === "desktop"}
          aria-label="Desktop preview"
          title="Desktop preview"
        >
          <Monitor className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`${ICON_BTN} ${previewMode === "mobile" ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
          onClick={() => onPreviewModeChange("mobile")}
          aria-pressed={previewMode === "mobile"}
          aria-label="Mobile preview"
          title="Mobile preview"
        >
          <Smartphone className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* -- Group 5: Design settings. On lg+ the settings panel is always
            visible as the right column, so the button is only for smaller
            screens — and on a phone it is the ONLY route to them. -- */}
      <div className="flex items-center gap-1 lg:hidden">
        <Divider />
        <button
          type="button"
          className={`${ICON_BTN} ${settingsOpen ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
          onClick={onToggleSettings}
          aria-pressed={settingsOpen}
          aria-label="Design settings"
          title="Design settings"
        >
          <SlidersHorizontal
            className="size-4"
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* -- Group 6 (phone only): everything the bar had to give up. -- */}
      <div ref={moreRef} className="relative sm:hidden">
        <button
          type="button"
          className={`${ICON_BTN} ${moreOpen ? PREVIEW_ACTIVE : PREVIEW_IDLE}`}
          onClick={() => setMoreOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More tools"
          title="More tools"
        >
          <Ellipsis className="size-4" strokeWidth={2} aria-hidden="true" />
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

              {/* The Element menu opens on HOVER, which a thumb does not do,
                  so the library needs a route that does not depend on one. */}
              <button
                type="button"
                role="menuitem"
                className={MORE_ITEM}
                onClick={() => {
                  onOpenShapesPanel();
                  setMoreOpen(false);
                }}
              >
                <Shapes className="size-4" strokeWidth={2} aria-hidden="true" />
                All shapes
              </button>

              <div aria-hidden="true" className="my-1 h-px bg-border" />

              {/* menuitemradio, not menuitem: the two preview modes are one
                  mutually-exclusive choice, and `menuitem` does not support a
                  selected state at all. */}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={previewMode === "desktop"}
                className={cn(MORE_ITEM, previewMode === "desktop" && "bg-accent")}
                onClick={() => {
                  onPreviewModeChange("desktop");
                  setMoreOpen(false);
                }}
              >
                <Monitor className="size-4" strokeWidth={2} aria-hidden="true" />
                Desktop preview
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={previewMode === "mobile"}
                className={cn(MORE_ITEM, previewMode === "mobile" && "bg-accent")}
                onClick={() => {
                  onPreviewModeChange("mobile");
                  setMoreOpen(false);
                }}
              >
                <Smartphone className="size-4" strokeWidth={2} aria-hidden="true" />
                Mobile preview
              </button>
          </div>
        )}
      </div>
    </div>
  );
}
