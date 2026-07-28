"use client";

/**
 * Figma-style floating toolbar fixed at the bottom-center of the storefront
 * designer. Three groups: insert tools, history, and preview-mode toggles.
 *
 * z-40 - intentionally sits below modals/sheets (z-50) so a panel opening
 * over the canvas does not fight for the same layer.
 */

import { useState } from "react";
import {
  Maximize2,
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
  WandSparkles,
} from "lucide-react";
import { SHAPE_KINDS, type ShapeKind } from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  focusRingClass as FOCUS_RING,
  iconPopClass,
  transitionClass as TRANSITION,
} from "@/components/ui/control-styles";
import { ShapeKindGlyph } from "./ShapeTileContent";
import { SHAPE_SPECS } from "./shape-specs";

/** Labelled insert-tool button: icon + text label (label hidden on mobile).
 *  `group/btn` lets the icon pop on hover/focus (see iconPopClass below). */
const INSERT_BTN =
  `group/btn inline-flex h-9 shrink-0 items-center gap-1.5 rounded-none px-2.5 text-xs font-medium ` +
  `text-muted-foreground hover:bg-accent hover:text-foreground ` +
  `disabled:pointer-events-none disabled:opacity-50 ${TRANSITION} ${FOCUS_RING}`;

/** The insert tools' icons all share the additive "pop" microinteraction. */
const INSERT_ICON = `size-4 ${iconPopClass}`;

/** Icon-only square button (size-9 = h-9 w-9). */
const ICON_BTN =
  `inline-flex size-9 shrink-0 items-center justify-center rounded-none ` +
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
  canAddBlocks,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomFit,
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
  canAddBlocks: boolean;      // false when the block cap is reached -> disable the insert tools
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Canvas scale, 1 = 100%. */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomFit: () => void;
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

  return (
    <div
      role="toolbar"
      aria-label="Editor tools"
      // No overflow clipping here: the shape menu pops out above the bar.
      className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex max-w-[calc(100vw-2rem)] items-center gap-1 rounded-md border border-border bg-background/95 p-1.5 shadow-md backdrop-blur"
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

      {/* Shape tool: hovering (or clicking, on touch) reveals a horizontal
          menu of the shapes themselves; picking one inserts it. */}
      <div
        className="group/shape relative"
        onMouseLeave={() => setShapeMenuOpen(false)}
      >
        <button
          type="button"
          className={INSERT_BTN}
          onClick={() => setShapeMenuOpen((open) => !open)}
          disabled={!canAddBlocks}
          aria-label="Add shape"
          aria-haspopup="true"
          aria-expanded={shapeMenuOpen}
          title="Add shape"
        >
          <Shapes className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
          <span className="hidden sm:inline">Shape</span>
        </button>

        {/* pb-1.5 (not a margin) bridges the visual gap between button and
            menu, so hover never drops while the pointer crosses it. */}
        <div
          className={cn(
            "absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-1.5",
            "transition-opacity duration-180 ease-in-out motion-reduce:transition-none",
            shapeMenuOpen
              ? "visible opacity-100"
              : "invisible opacity-0 group-hover/shape:visible group-hover/shape:opacity-100 group-focus-within/shape:visible group-focus-within/shape:opacity-100",
          )}
        >
          {/* Horizontal strip: the library outgrew the viewport, so it
              scrolls sideways rather than wrapping into a block. */}
          <div
            role="menu"
            aria-label="Shapes"
            className="flex max-w-[min(90vw,32rem)] items-center gap-1 overflow-x-auto rounded-md border border-border bg-background/95 p-1.5 shadow-md backdrop-blur"
          >
            {SHAPE_KINDS.map((kind) => (
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

      <Divider />

      {/* -- Group 3: ZOOM. The percentage doubles as "reset to 100%". -- */}
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
        aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to 100%`}
        title="Reset zoom (Ctrl 0)"
        className={`${INSERT_BTN} min-w-14 justify-center tabular-nums`}
      >
        {Math.round(zoom * 100)}%
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
      <button
        type="button"
        className={ICON_BTN}
        onClick={onZoomFit}
        aria-label="Fit the canvas to the screen"
        title="Zoom to fit"
      >
        <Maximize2 className="size-4" strokeWidth={2} aria-hidden="true" />
      </button>

      <Divider />

      {/* -- Group 4: PREVIEW mode -- */}
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

      {/* -- Group 5 (mobile only): the Design settings sheet. On lg+ the
            settings panel is always visible as the right column. -- */}
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
    </div>
  );
}
