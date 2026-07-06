"use client";

/**
 * Figma-style floating toolbar fixed at the bottom-center of the storefront
 * designer. Three groups: insert tools, history, and preview-mode toggles.
 *
 * z-40 - intentionally sits below modals/sheets (z-50) so a panel opening
 * over the canvas does not fight for the same layer.
 */

import {
  Monitor,
  Redo2,
  Shapes,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  SquareDashed,
  Type,
  Undo2,
} from "lucide-react";
import {
  focusRingClass as FOCUS_RING,
  iconPopClass,
  transitionClass as TRANSITION,
} from "@/components/ui/control-styles";

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
  onAddSpacer,
  canAddBlocks,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  previewMode,
  onPreviewModeChange,
  settingsOpen,
  onToggleSettings,
}: {
  onAddProduct: () => void;   // opens the product picker card (does not insert directly)
  onAddText: () => void;
  onAddShape: () => void;
  onAddSpacer: () => void;
  canAddBlocks: boolean;      // false when the block cap is reached -> disable the 4 insert tools
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  previewMode: "desktop" | "mobile";
  onPreviewModeChange: (mode: "desktop" | "mobile") => void;
  /** Mobile only: the Design bottom sheet (global settings) toggle. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Editor tools"
      className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-md border border-border bg-background/95 p-1.5 shadow-md backdrop-blur"
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

      <button
        type="button"
        className={INSERT_BTN}
        onClick={onAddShape}
        disabled={!canAddBlocks}
        aria-label="Add shape"
        title="Add shape"
      >
        <Shapes className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Shape</span>
      </button>

      <button
        type="button"
        className={INSERT_BTN}
        onClick={onAddSpacer}
        disabled={!canAddBlocks}
        aria-label="Add spacer"
        title="Add spacer"
      >
        <SquareDashed className={INSERT_ICON} strokeWidth={2} aria-hidden="true" />
        <span className="hidden sm:inline">Spacer</span>
      </button>

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

      <Divider />

      {/* -- Group 3: PREVIEW mode -- */}
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

      {/* -- Group 4 (mobile only): the Design settings sheet. On lg+ the
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
