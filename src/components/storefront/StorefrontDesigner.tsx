"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import type { Product } from "@/types/product";
import {
  CANVAS_COLUMNS_MIN,
  CANVAS_ROWS_MAX,
  CANVAS_ROWS_MIN,
  DEFAULT_STOREFRONT_HEADER,
  blockKey,
  mergeCardStyleOverrides,
  readingOrder,
  type BlockPlacement,
  type CardStyleOverrides,
  type ShapeBlock,
  type ShapeKind,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import {
  findFreeCell,
  packFirstFit,
  placementIsFree,
} from "@/components/grid/gridConstants";
import { MAX_BLOCKS, STOREFRONT_NAME_MAX } from "@/lib/validation/storefront";
import { saveStorefront } from "@/lib/storefront/actions";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  helpTextClass,
  iconButtonClass,
  iconNudgeLeftClass,
} from "@/components/ui/control-styles";
import { ControlsPanel } from "./ControlsPanel";
import { DesignerCanvas } from "./DesignerCanvas";
import { EditorToolbar } from "./EditorToolbar";
import { ProductPicker } from "./ProductPicker";
import { ProductBlockEditor } from "./ProductBlockEditor";
import { ShapeBlockEditor, type ShapeBlockPatch } from "./ShapeBlockEditor";
import { TextBlockEditor, type TextBlockPatch } from "./TextBlockEditor";
import { useCanvasViewport } from "./useCanvasViewport";
import { useEditorHistory } from "./useEditorHistory";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import { SearchProvider, useSearch } from "@/components/search/SearchProvider";
import type { TeamRole } from "@/lib/team/permissions";

/** What the left inspector column shows: the product picker, or the editor
 *  card for one selected block. */
type InspectorState = { kind: "picker" } | { kind: "block"; key: string };

/** The undoable slice of editor state (name is excluded — the top-bar input
 *  has its own native undo and per-keystroke history would drown edits). */
type EditorSnapshot = {
  theme: StorefrontTheme;
  header: StorefrontHeader;
  blocks: StorefrontBlock[];
};

/** First shallowly-changed field, used as the history coalesce key so rapid
 *  same-field edits (color drags, slider scrubs) undo as one step. */
function changedField<T extends object>(prev: T, next: T): string {
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (prev[key] !== next[key]) return String(key);
  }
  return "unchanged";
}

const INSPECTOR_CLOSE_CLASS =
  "inline-flex size-7 items-center justify-center rounded-none text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";

/** Mobile emergency-edit layout: panels become slide-up bottom sheets over the
 *  canvas (scrollable, padded to clear the floating toolbar); on lg+ the same
 *  element renders as a plain block in the right column. */
/** Canvas zoom bounds. A view preference only: never saved, never seen by
 *  buyers, and deliberately NOT affecting layout width, so zooming out never
 *  trips the grid's small-screen reflow. */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

/** Breathing room left around the board when it is centred or fitted. */
const CANVAS_MARGIN = 24;

/** Rough line height / page size used to convert non-pixel wheel deltas. */
const WHEEL_LINE_PX = 16;

/**
 * Wheel deltas in PIXELS, whatever the device reported. Firefox sends whole
 * lines for a mouse wheel (deltaY: ±1, deltaMode 1) while Chrome and Safari
 * send pixels, so treating every delta as pixels made a mouse wheel crawl one
 * pixel per notch there.
 */
function normalizeWheel(event: WheelEvent): { x: number; y: number } {
  const scale =
    event.deltaMode === 1
      ? WHEEL_LINE_PX
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

/**
 * Keep the workspace point under (anchorX, anchorY) pinned while the zoom
 * changes, so zooming happens about the cursor instead of the corner. The
 * board point under the anchor is `(anchor - pan) / zoom`; solving for the
 * pan that keeps it there at the new zoom gives this.
 */
function panAfterZoom(
  pan: { x: number; y: number },
  from: number,
  to: number,
  anchorX: number,
  anchorY: number,
): { x: number; y: number } {
  return {
    x: anchorX - ((anchorX - pan.x) / from) * to,
    y: anchorY - ((anchorY - pan.y) / from) * to,
  };
}

/** Design panel width bounds, in px (desktop only). Dragging the edge below
 *  the minimum collapses the panel rather than squeezing it unusably narrow. */
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 560;
const PANEL_DEFAULT_WIDTH = 320;
/** How far one arrow-key press nudges the panel edge. */
const PANEL_RESIZE_STEP = 16;

/** The little tab that collapses / reopens the panel: a chip clipped to the
 *  panel's left edge (desktop only — mobile uses bottom sheets).
 *
 *  No shadow: the tab has no right border (it butts up against the panel), so
 *  a box-shadow spills out of that open edge and paints a seam down the join.
 *  The border on the other three sides is the whole affordance. */
const PANEL_TAB_CLASS =
  "absolute top-1/2 z-30 hidden h-12 w-5 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-border bg-background text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none lg:flex";

const SHEET_ON_MOBILE_CLASS =
  "fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-lg border-t border-border bg-background p-4 pb-24 shadow-lg lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:pb-0 lg:shadow-none";

/**
 * Page-level composition + state owner for the storefront designer. Content is
 * inserted from the bottom toolbar; the selected block's editor card opens in
 * the LEFT inspector column; global design settings live in the RIGHT panel.
 * Blocks are kept in array order; `order` integers are assigned on save.
 * Client-side constraints are UX only — the save action re-validates with Zod
 * and re-checks product ownership server-side.
 */
export function StorefrontDesigner({
  storefrontId,
  initialName,
  initialConfig,
  products,
  initialBackgroundImageUrl = null,
  role = null,
  accountId = null,
}: {
  storefrontId: string;
  initialName: string;
  initialConfig: StorefrontConfig;
  products: Product[];
  /** Signed display URL for a stored image background (null when none). */
  initialBackgroundImageUrl?: string | null;
  /** Active account role, for universal search's action gating. */
  role?: TeamRole | null;
  /** Active account id, for universal search's snapshot cache. */
  accountId?: string | null;
}) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  // Display URL for the image background: server-signed at load; replaced by
  // a local object URL right after an in-session upload. NOT part of the
  // config (the config stores only the object key).
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(
    initialBackgroundImageUrl,
  );
  // Catalog snapshot, updated in place after inline product edits. Product
  // facts (name/price) are saved to the DB immediately by the block editor;
  // they are NOT part of the storefront config, so they bypass the dirty flag
  // and undo history; this state only keeps the canvas tiles in sync.
  const [catalog, setCatalog] = useState(products);
  const [theme, setTheme] = useState<StorefrontTheme>(initialConfig.theme);
  const [header, setHeader] = useState<StorefrontHeader>(
    initialConfig.header ?? DEFAULT_STOREFRONT_HEADER,
  );
  // Placement is explicit, so the array is just a bag of blocks.
  const [blocks, setBlocks] = useState<StorefrontBlock[]>(initialConfig.blocks);
  const [saving, setSaving] = useState(false);
  // Unsaved-edits flag. The header shows exactly one thing — whether there is
  // work not yet written — while the OUTCOME of a save (done / dropped blocks
  // / failed) is a toast, so it reaches the eye even in the full-screen editor
  // where the Save button is a long way from the canvas being edited.
  const [dirty, setDirty] = useState(false);
  const [inspector, setInspector] = useState<InspectorState | null>(null);
  // Mobile only: whether the global-settings bottom sheet is open (on lg+ the
  // settings panel is always visible, so this is ignored there).
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Desktop only: whether the edge-docked design panel is shown. Collapsing
  // it gives the canvas the full viewport width.
  const [panelOpen, setPanelOpen] = useState(true);
  // Dashed empty-slot guides on the canvas. A VIEW preference: buyers never
  // see them, so it stays out of the saved config (and out of undo history).
  const [showGrid, setShowGrid] = useState(true);
  // Desktop panel width, dragged from its left edge. Kept at or above the
  // minimum: a drag that would go narrower closes the panel instead, so
  // reopening never lands on an unusably thin strip.
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  // The free cell the seller clicked, so the next inserted block lands there.
  const [insertHint, setInsertHint] = useState<{ x: number; y: number } | null>(
    null,
  );
  // Pan + zoom live here, OUTSIDE React state, and are written straight to
  // the stage each frame. Gestures therefore cause no re-renders at all.
  const viewport = useCanvasViewport({ zoom: 1, pan: { x: 0, y: 0 } });
  // True while a pan gesture is running, so the cursor can say so.
  const [panning, setPanning] = useState(false);
  // Space held = temporary pan tool, the shortcut every canvas app shares.
  const [spaceHeld, setSpaceHeld] = useState(false);
  // The window the board moves behind: owns wheel pan/zoom and fit.
  const canvasViewportRef = useRef<HTMLElement>(null);
  // Preview device for the canvas frame — toolbar-owned, never persisted.
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const history = useEditorHistory<EditorSnapshot>();
  // Prompt to save/discard when leaving with unsaved edits (Back link, browser
  // Back button, refresh/close). `dirty` alone drives whether it's armed.
  const leaveGuard = useUnsavedChangesGuard(dirty, "/storefront");

  const productsById = useMemo(
    () => new Map(catalog.map((product) => [product.id, product])),
    [catalog],
  );
  const usedProductIds = useMemo(
    () =>
      new Set(
        blocks
          .filter((block) => block.type === "product")
          .map((block) => block.productId),
      ),
    [blocks],
  );
  // The block whose card the inspector shows. Deriving (not storing) means a
  // removed/undone-away block simply closes the card instead of going stale.
  const selectedBlock = useMemo<StorefrontBlock | null>(() => {
    if (inspector?.kind !== "block") return null;
    return blocks.find((b) => blockKey(b) === inspector.key) ?? null;
  }, [blocks, inspector]);

  function markDirty() {
    setDirty(true);
  }

  /** Every undoable mutation calls this FIRST with an optional coalesce key. */
  function recordChange(coalesceKey?: string) {
    history.record({ theme, header, blocks }, coalesceKey);
    markDirty();
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    setTheme(snapshot.theme);
    setHeader(snapshot.header);
    setBlocks(snapshot.blocks);
    markDirty();
  }

  function undo() {
    const previous = history.undo({ theme, header, blocks });
    if (previous) applySnapshot(previous);
  }

  function redo() {
    const next = history.redo({ theme, header, blocks });
    if (next) applySnapshot(next);
  }

  // Ctrl/Cmd+Z / Shift+Z / Y. The listener subscribes ONCE and reads the
  // latest handlers through a ref, so renders never churn add/removeListener.
  // Skipped while typing (text fields keep their native undo) and while a
  // custom Select dropdown is open (its trigger is a button, not an input).
  const historyActions = useRef({ undo, redo });
  useEffect(() => {
    historyActions.current = { undo, redo };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest('[role="combobox"][aria-expanded="true"]') !== null)
      ) {
        return;
      }
      event.preventDefault();
      if (key === "y" || event.shiftKey) historyActions.current.redo();
      else historyActions.current.undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The wheel drives the workspace: Ctrl/Cmd (or a trackpad pinch, which
  // arrives as the same event) zooms about the pointer; a plain scroll pans.
  // Every event mutates the viewport ref SYNCHRONOUSLY, so a burst of events
  // accumulates instead of each one recomputing from a stale origin.
  // Registered non-passively so the browser's own scroll/zoom is preventable.
  useEffect(() => {
    const area = canvasViewportRef.current;
    if (!area) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const { x: deltaX, y: deltaY } = normalizeWheel(event);
      if (event.ctrlKey || event.metaKey) {
        const rect = area!.getBoundingClientRect();
        const anchorX = event.clientX - rect.left;
        const anchorY = event.clientY - rect.top;
        viewport.set((current) => {
          const zoom = clampZoom(current.zoom * Math.exp(-deltaY / 300));
          return {
            zoom,
            pan: panAfterZoom(current.pan, current.zoom, zoom, anchorX, anchorY),
          };
        });
        return;
      }
      viewport.set((current) => ({
        zoom: current.zoom,
        pan: { x: current.pan.x - deltaX, y: current.pan.y - deltaY },
      }));
    }
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [viewport]);

  // A shrinking window (or the design panel widening) can leave the board
  // outside the new limits, so re-clamp whenever the workspace resizes. An
  // identity set is enough: the clamp runs on every write.
  useEffect(() => {
    const area = canvasViewportRef.current;
    if (!area) return;
    const observer = new ResizeObserver(() => {
      viewport.set((current) => current);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [viewport]);

  // Space = hold-to-pan. Ignored while typing, and while a button has focus
  // (there space is that button's activation key).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "BUTTON" ||
        element.isContentEditable
      );
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      event.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setSpaceHeld(false);
    }
    // A lost window (alt-tab mid-hold) would otherwise strand the pan tool.
    function onBlur() {
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /**
   * Delete / Backspace removes the selected block — the shortcut every canvas
   * tool has. Same subscribe-once + ref shape as the undo listener above, so
   * selecting a tile never churns add/removeListener.
   *
   * Guarded on the event target, not just on "is something selected": the
   * inspector for the selected block is full of fields (the text block's
   * textarea, a product's name and price, the hex input), and a Backspace
   * there must edit the value the seller is typing, never delete the tile
   * they are typing about. Modified presses are left alone too — Cmd/Alt +
   * Backspace are word/line deletes that belong to whatever has focus.
   *
   * preventDefault because Backspace outside a field is historically "go
   * back", and losing unsaved design work to a navigation would be brutal.
   */
  const deleteShortcut = useRef<{ selectedKey: string | null }>({
    selectedKey: null,
  });
  useEffect(() => {
    deleteShortcut.current.selectedKey =
      inspector?.kind === "block" ? inspector.key : null;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = deleteShortcut.current.selectedKey;
      if (!key) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      canvasActions.current.removeBlock(key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Cmd/Ctrl +/-/0, the shortcuts every canvas tool shares.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        viewActions.current.zoomBy(ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        viewActions.current.zoomBy(-ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        viewActions.current.resetZoom();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The inspector and the mobile settings sheet share the small screen — at
  // most one is open at a time.
  function selectBlock(key: string | null) {
    setInspector(key === null ? null : { kind: "block", key });
    if (key !== null) setSettingsOpen(false);
  }

  /** Clicking a free cell opens the picker; whatever is added next lands in
   *  that cell rather than the first free one. */
  function insertAt(x: number, y: number) {
    setInsertHint({ x, y });
    setInspector({ kind: "picker" });
    setSettingsOpen(false);
  }

  /** Consume the pending insert cell (one use only). */
  function takeInsertHint(): { x: number; y: number } | undefined {
    const hint = insertHint ?? undefined;
    if (hint) setInsertHint(null);
    return hint;
  }

  /** The viewport window and the board's UNSCALED size (offsetWidth/Height
   *  ignore transforms, so these are the natural dimensions). */
  function measureView() {
    const area = canvasViewportRef.current;
    const stage = viewport.stage();
    if (!area || !stage || stage.offsetWidth <= 0) return null;
    return { area, width: stage.offsetWidth, height: stage.offsetHeight };
  }

  /** Drop the board in the middle of the workspace at the given scale. */
  function centerCanvas(atZoom: number) {
    const view = measureView();
    if (!view) return;
    viewport.set({
      zoom: atZoom,
      pan: {
        x: (view.area.clientWidth - view.width * atZoom) / 2,
        y: Math.max(
          CANVAS_MARGIN,
          (view.area.clientHeight - view.height * atZoom) / 2,
        ),
      },
    });
  }

  /** Toolbar zoom: about the middle of the window, not the corner. */
  function zoomBy(delta: number) {
    const area = canvasViewportRef.current;
    viewport.set((current) => {
      const zoom = clampZoom(current.zoom + delta);
      if (!area) return { ...current, zoom };
      return {
        zoom,
        pan: panAfterZoom(
          current.pan,
          current.zoom,
          zoom,
          area.clientWidth / 2,
          area.clientHeight / 2,
        ),
      };
    });
  }

  function resetZoom() {
    centerCanvas(1);
  }

  // The one-shot listeners below read these through a ref, so they never
  // need re-subscribing when a render changes the closures.
  const viewActions = useRef({ zoomBy, resetZoom });
  useEffect(() => {
    viewActions.current = { zoomBy, resetZoom };
  });

  // Identity-stable canvas callbacks. The canvas is memoised, so a render
  // caused by something it does not display (typing the storefront name, for
  // instance) must not hand it fresh function props — that alone re-rendered
  // every tile, measured at 46ms per keystroke on a full board.
  const canvasActions = useRef({
    moveBlock,
    resizeBlock,
    removeBlock,
    insertAt,
    selectBlock,
  });
  useEffect(() => {
    canvasActions.current = {
      moveBlock,
      resizeBlock,
      removeBlock,
      insertAt,
      selectBlock,
    };
  });
  const onMoveBlock = useCallback((key: string, x: number, y: number) => {
    canvasActions.current.moveBlock(key, x, y);
  }, []);
  const onResizeBlock = useCallback((key: string, placement: BlockPlacement) => {
    canvasActions.current.resizeBlock(key, placement);
  }, []);
  const onRemoveBlock = useCallback((key: string) => {
    canvasActions.current.removeBlock(key);
  }, []);
  const onInsertAt = useCallback((x: number, y: number) => {
    canvasActions.current.insertAt(x, y);
  }, []);
  const onSelectBlock = useCallback((key: string | null) => {
    canvasActions.current.selectBlock(key);
  }, []);

  /**
   * Scale the whole board to fit the window, then centre it. Used ONLY for the
   * first paint, when the board is wider than the workspace (always the case on
   * a phone) — without it the editor would open cropped at 100% with the
   * content off-screen. There is deliberately no "zoom to fit" control: zoom is
   * a per-gesture thing, and the toolbar reads better with fewer buttons.
   */
  function fitOnFirstPaint() {
    const view = measureView();
    if (!view) return;
    const zoom = clampZoom(
      Math.min(
        (view.area.clientWidth - CANVAS_MARGIN * 2) / view.width,
        (view.area.clientHeight - CANVAS_MARGIN * 2) / view.height,
      ),
    );
    viewport.set({
      zoom,
      pan: {
        x: (view.area.clientWidth - view.width * zoom) / 2,
        // Top-aligned, NOT vertically centred. A fitted board is short relative
        // to the window (on a phone it lands around half the height), and
        // centring it left a dead band across the top of the screen with the
        // content stranded in the middle. Starting at the top puts the board
        // where the eye lands and leaves the free space at the bottom, where
        // the sheets and toolbar live anyway.
        y: CANVAS_MARGIN,
      },
    });
  }

  /**
   * Two-finger pinch: the ONLY way to zoom on a phone, where the toolbar's
   * zoom buttons are hidden (they cost more thumb-width than they are worth).
   * The workspace sets `touch-none`, so no native gesture competes and we get
   * raw pointer events for both fingers.
   *
   * Tracked here rather than in the canvas because zoom and pan live on the
   * viewport store this component owns.
   */
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{
    distance: number;
    zoom: number;
    midX: number;
    midY: number;
    pan: { x: number; y: number };
  } | null>(null);

  function pinchGeometry() {
    const [a, b] = [...touchPoints.current.values()];
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  function onCanvasPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      touchPoints.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (touchPoints.current.size === 2) {
        const { distance, midX, midY } = pinchGeometry();
        pinchStart.current = {
          distance,
          zoom: viewport.get().zoom,
          midX,
          midY,
          pan: { ...viewport.get().pan },
        };
        // A finger may already be dragging a tile or panning. Both of those
        // end on pointercancel, so this hands the gesture over cleanly instead
        // of letting a tile follow one finger through the pinch.
        window.dispatchEvent(new PointerEvent("pointercancel"));
        return;
      }
    }
    startPan(event);
  }

  function onCanvasPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") return;
    if (!touchPoints.current.has(event.pointerId)) return;
    touchPoints.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const start = pinchStart.current;
    if (!start || touchPoints.current.size !== 2) return;
    event.preventDefault();

    const { distance, midX, midY } = pinchGeometry();
    if (start.distance === 0) return;
    const zoom = clampZoom((distance / start.distance) * start.zoom);
    // Keep the board point that started under the pinch centre pinned there,
    // then add however far the centre itself travelled (pinch pans too).
    const pinned = panAfterZoom(start.pan, start.zoom, zoom, start.midX, start.midY);
    viewport.set(() => ({
      zoom,
      pan: {
        x: pinned.x + (midX - start.midX),
        y: pinned.y + (midY - start.midY),
      },
    }));
  }

  function onCanvasPointerUp(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") return;
    touchPoints.current.delete(event.pointerId);
    // Lifting one finger ends the pinch; it does NOT resume a pan, or the
    // board would jump to track the remaining finger.
    if (touchPoints.current.size < 2) pinchStart.current = null;
  }

  // A finger can leave the workspace before it lifts, and then the element's
  // own pointerup never fires. Without this the id would stay in the map and
  // the next single touch would look like a second finger, starting a phantom
  // pinch. Pruning on window catches the release wherever it happens.
  useEffect(() => {
    function prune(event: PointerEvent) {
      touchPoints.current.delete(event.pointerId);
      if (touchPoints.current.size < 2) pinchStart.current = null;
    }
    window.addEventListener("pointerup", prune);
    window.addEventListener("pointercancel", prune);
    return () => {
      window.removeEventListener("pointerup", prune);
      window.removeEventListener("pointercancel", prune);
    };
  }, []);

  /**
   * Pan gestures: the middle button, space held, or a left-press that landed
   * on the workspace BACKGROUND (dragging beside the board moves it, while a
   * press on a tile still drags that tile).
   */
  function startPan(event: React.PointerEvent<HTMLElement>) {
    const onBackground = event.target === event.currentTarget;
    const wanted =
      event.button === 1 || (event.button === 0 && (spaceHeld || onBackground));
    if (!wanted) return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { ...viewport.get().pan };
    setPanning(true);

    function onMove(moveEvent: PointerEvent) {
      viewport.set((current) => ({
        zoom: current.zoom,
        pan: {
          x: origin.x + (moveEvent.clientX - startX),
          y: origin.y + (moveEvent.clientY - startY),
        },
      }));
    }
    function stop() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setPanning(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  // Place the board sensibly on first paint: centred, or scaled down first
  // when it is wider than the window. Runs once — after that the view is the
  // seller's to move.
  const placedInitialView = useRef(false);
  useEffect(() => {
    if (placedInitialView.current || previewMode !== "desktop") return;
    let frame = 0;
    // The stage may not have laid out on the very first tick.
    function place(attempt: number) {
      const view = measureView();
      if (!view) {
        if (attempt < 5) frame = requestAnimationFrame(() => place(attempt + 1));
        return;
      }
      placedInitialView.current = true;
      if (view.width + CANVAS_MARGIN * 2 > view.area.clientWidth) fitOnFirstPaint();
      else centerCanvas(1);
    }
    place(0);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot placement
  }, [previewMode]);

  function togglePicker() {
    setInspector((current) =>
      current?.kind === "picker" ? null : { kind: "picker" },
    );
    setSettingsOpen(false);
  }

  function toggleSettings() {
    const next = !settingsOpen;
    setSettingsOpen(next);
    if (next) setInspector(null);
  }

  /** The blocks as the grid's placement helpers want them. */
  function canvasBlocks() {
    return blocks.map((block) => ({
      key: blockKey(block),
      x: block.x,
      y: block.y,
      w: block.w,
      h: block.h,
      data: null,
    }));
  }

  /**
   * Where a new w x h block should land: the cell the seller pointed at when
   * it is free, otherwise the first free spot, otherwise a freshly grown row.
   * Null when the board is full at its maximum height.
   */
  function findSpot(
    w: number,
    h: number,
    at?: { x: number; y: number },
  ): (BlockPlacement & { growRows?: number }) | null {
    const existing = canvasBlocks();
    const { columns, rows } = theme;
    if (
      at &&
      placementIsFree(existing, { ...at, w, h }, null, columns, rows)
    ) {
      return { ...at, w, h };
    }
    const free = findFreeCell(existing, w, h, columns, rows);
    if (free) return { ...free, w, h };

    // Board full: grow it rather than refusing the block.
    const grown = Math.min(CANVAS_ROWS_MAX, rows + h);
    if (grown > rows) {
      const spot = findFreeCell(existing, w, h, columns, grown);
      if (spot) return { ...spot, w, h, growRows: grown };
    }
    return null;
  }

  /** Commit a new block at a found spot, growing the canvas if that's what
   *  the spot needed. */
  function insertBlock(
    build: (placement: BlockPlacement) => StorefrontBlock,
    w: number,
    h: number,
    at?: { x: number; y: number },
  ): StorefrontBlock | null {
    if (blocks.length >= MAX_BLOCKS) return null;
    const spot = findSpot(w, h, at);
    if (!spot) return null;
    recordChange();
    if (spot.growRows) setTheme({ ...theme, rows: spot.growRows });
    const block = build({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
    setBlocks((current) => [...current, block]);
    return block;
  }

  function addProduct(productId: string) {
    if (usedProductIds.has(productId)) return;
    insertBlock(
      (placement) => ({ type: "product", productId, ...placement }),
      1,
      1,
      takeInsertHint(),
    );
    // The picker stays open so several products can be added in one pass.
  }

  function addTextBlock() {
    const block = insertBlock(
      (placement) => ({
        type: "text",
        id: crypto.randomUUID(),
        text: "Your text here",
        variant: "heading",
        align: "left",
        ...placement,
      }),
      Math.min(2, theme.columns),
      1,
      takeInsertHint(),
    );
    if (block) selectBlock(blockKey(block));
  }

  function addShapeBlock(kind: ShapeKind) {
    const block = insertBlock(
      (placement) => ({
        type: "shape",
        id: crypto.randomUUID(),
        kind,
        // Accent is the natural starting fill.
        color: theme.accent,
        ...placement,
      }),
      1,
      1,
      takeInsertHint(),
    );
    if (block) selectBlock(blockKey(block));
  }

  function removeBlock(key: string) {
    recordChange();
    setBlocks((current) => current.filter((b) => blockKey(b) !== key));
    setInspector((current) =>
      current?.kind === "block" && current.key === key ? null : current,
    );
  }

  // COPY / PASTE, for text and shape blocks. Editor-internal (a ref, not the
  // system clipboard): the payload is a live config block, and pasting mints
  // a fresh id, so nothing round-trips through serialized text. Product
  // blocks are deliberately excluded — a product tile IS its product (one
  // block per product, keyed by productId), so there is nothing valid a
  // pasted copy could be.
  const clipboard = useRef<TextBlock | ShapeBlock | null>(null);

  /** Insert a copy of a text/shape block with a fresh id, preferring the
   *  clicked cell, then the spot just right of the source, then the first
   *  free cell (insertBlock's fallback). Selects the copy. */
  function pasteBlock(source: TextBlock | ShapeBlock) {
    const copy = insertBlock(
      (placement) => ({
        ...structuredClone(source),
        id: crypto.randomUUID(),
        ...placement,
      }),
      source.w,
      source.h,
      takeInsertHint() ?? { x: source.x + source.w, y: source.y },
    );
    if (copy) selectBlock(blockKey(copy));
  }

  /** Copy the selected block into the editor clipboard (text/shape only). */
  function copySelectedBlock() {
    if (inspector?.kind !== "block") return;
    const source = blocks.find((b) => blockKey(b) === inspector.key);
    if (!source || source.type === "product") return;
    clipboard.current = structuredClone(source);
    toast.success("Block copied.", { lines: ["Paste with Ctrl+V or Cmd+V."] });
  }

  function pasteClipboard() {
    if (clipboard.current) pasteBlock(clipboard.current);
  }

  /** Copy + paste in one step, for the inspector's Duplicate button (the
   *  no-keyboard path). Also fills the clipboard, so Ctrl+V repeats it. */
  function duplicateBlock(key: string) {
    const source = blocks.find((b) => blockKey(b) === key);
    if (!source || source.type === "product") return;
    clipboard.current = structuredClone(source);
    pasteBlock(source);
  }

  // Ctrl/Cmd+C / V. Same subscribe-once + ref shape as the undo listener, and
  // the same guards: never while typing (fields keep native copy/paste), and
  // copy also yields whenever real text is selected on the page, so copying
  // prose from the inspector never turns into copying the tile behind it.
  const clipboardActions = useRef({ copySelectedBlock, pasteClipboard });
  useEffect(() => {
    clipboardActions.current = { copySelectedBlock, pasteClipboard };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (key === "c") {
        if (window.getSelection()?.toString()) return;
        clipboardActions.current.copySelectedBlock();
      } else {
        clipboardActions.current.pasteClipboard();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function moveBlock(key: string, x: number, y: number) {
    recordChange(`move:${key}`);
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, x, y } : b)),
    );
  }

  /** Takes the whole placement: stretching a tile up or left moves its origin
   *  as well as its span, so x/y have to travel with w/h. */
  function resizeBlock(key: string, placement: BlockPlacement) {
    recordChange(`size:${key}`);
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, ...placement } : b)),
    );
  }

  /** Pack every block toward the top-left in reading order — the old
   *  auto-flow layout, available on demand for sellers who don't want to
   *  place things by hand. */
  function tidyBlocks() {
    recordChange();
    setBlocks((current) => {
      const ordered = readingOrder(current);
      const packed = packFirstFit(
        ordered.map((block) => ({ w: block.w, h: block.h })),
        theme.columns,
      );
      return ordered.map((block, index) => ({
        ...block,
        x: packed[index].x,
        y: packed[index].y,
      }));
    });
  }

  /** Resize the canvas itself. Shrinking never cuts a block off: the minimum
   *  is whatever the current content extends to. */
  function updateCanvas(columns: number, rows: number) {
    const minColumns = blocks.reduce(
      (max, block) => Math.max(max, block.x + block.w),
      CANVAS_COLUMNS_MIN,
    );
    const minRows = blocks.reduce(
      (max, block) => Math.max(max, block.y + block.h),
      CANVAS_ROWS_MIN,
    );
    updateTheme({
      ...theme,
      columns: Math.max(columns, minColumns),
      rows: Math.max(rows, minRows),
    });
  }

  function toggleSoldOut(key: string) {
    recordChange();
    setBlocks((current) =>
      current.map((b) =>
        b.type === "product" && blockKey(b) === key
          ? { ...b, soldOut: !b.soldOut }
          : b,
      ),
    );
  }

  /**
   * Merge a card-style patch into one product block's overrides. Overrides
   * store ONLY what differs from following the theme, so an override object
   * that empties out is dropped entirely and the block goes back to being
   * indistinguishable from one that was never customized (the merge
   * semantics live in mergeCardStyleOverrides).
   */
  function updateProductBlockStyle(key: string, patch: CardStyleOverrides) {
    // Coalesce per field, so a slider scrub is one undo step but edits to
    // different controls stay separate steps.
    recordChange(`pstyle:${key}:${Object.keys(patch)[0] ?? ""}`);
    setBlocks((current) =>
      current.map((b) => {
        if (b.type !== "product" || blockKey(b) !== key) return b;
        const style = mergeCardStyleOverrides(b.style, patch);
        if (style === undefined) {
          const rest = { ...b };
          delete rest.style;
          return rest;
        }
        return { ...b, style };
      }),
    );
  }

  /** Drop a product block's overrides so it follows the theme again. */
  function resetProductBlockStyle(key: string) {
    recordChange();
    setBlocks((current) =>
      current.map((b) => {
        if (b.type !== "product" || blockKey(b) !== key || !b.style) return b;
        const rest = { ...b };
        delete rest.style;
        return rest;
      }),
    );
  }

  function updateTextBlock(key: string, patch: TextBlockPatch) {
    recordChange(`text:${key}`);
    setBlocks((current) =>
      current.map((b) =>
        b.type === "text" && blockKey(b) === key ? { ...b, ...patch } : b,
      ),
    );
  }

  function updateShapeBlock(key: string, patch: ShapeBlockPatch) {
    recordChange(`shape:${key}`);
    setBlocks((current) =>
      current.map((b) =>
        b.type === "shape" && blockKey(b) === key ? { ...b, ...patch } : b,
      ),
    );
  }

  function updateTheme(next: StorefrontTheme) {
    recordChange(`theme:${changedField(theme, next)}`);
    setTheme(next);
  }

  function updateHeader(next: StorefrontHeader) {
    recordChange(`header:${changedField(header, next)}`);
    setHeader(next);
  }

  function updateName(next: string) {
    markDirty();
    setName(next);
  }

  /** Commit a dragged/keyed panel edge: clamp to the max, and treat anything
   *  under the minimum as "collapse" rather than shrinking further. */
  function resizePanelTo(width: number): boolean {
    if (width < PANEL_MIN_WIDTH) {
      setPanelOpen(false);
      return false;
    }
    setPanelWidth(Math.min(PANEL_MAX_WIDTH, width));
    return true;
  }

  /** Pointer-drag the panel's left edge. The panel is flush with the right
   *  side of the viewport, so its width is simply the distance from the
   *  pointer to that edge. */
  function startPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = panelWidth;

    function onMove(moveEvent: PointerEvent) {
      if (!resizePanelTo(window.innerWidth - moveEvent.clientX)) {
        // Collapsed by dragging past the minimum: reopen at the width the
        // panel had BEFORE this drag, not the sliver it passed through on
        // the way out.
        setPanelWidth(startWidth);
        stop();
      }
    }
    function stop() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      // Restore the text selection / cursor suppression used while dragging.
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  function onPanelResizeKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizePanelTo(panelWidth + PANEL_RESIZE_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      resizePanelTo(panelWidth - PANEL_RESIZE_STEP);
    }
  }

  function applyProductUpdate(updated: Product) {
    setCatalog((current) =>
      current.map((p) => (p.id === updated.id ? updated : p)),
    );
  }

  /**
   * Merge picker-search results into the catalogue. The seed catalogue is
   * bounded (newest 500), so a search can surface products this component has
   * never seen; they must exist in `catalog` before a block referencing them
   * renders, or the block would be dropped as unknown. Existing entries win:
   * they may carry local edits (applyProductUpdate) not yet reflected in a
   * stale search payload.
   */
  const mergeFoundProducts = useCallback((found: Product[]) => {
    if (found.length === 0) return;
    setCatalog((current) => {
      const known = new Set(current.map((p) => p.id));
      const fresh = found.filter((p) => !known.has(p.id));
      return fresh.length > 0 ? [...current, ...fresh] : current;
    });
  }, []);

  /** Returns whether the save succeeded, so callers (e.g. save-then-leave) can
   *  branch on it without re-reading async state. */
  async function handleSave(): Promise<boolean> {
    setSaving(true);
    const config: StorefrontConfig = {
      theme,
      // Blocks carry their own coordinates, so array order is irrelevant.
      blocks,
      header,
      // Embed settings are edited in the list-page modal, not here — pass the
      // loaded value through so a designer save never wipes them.
      ...(initialConfig.embed ? { embed: initialConfig.embed } : {}),
    };
    const result = await saveStorefront(storefrontId, { name, config });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error.message, { lines: [result.error.fix] });
      return false;
    }
    if (result.droppedBlocks > 0) {
      // Server dropped refs to deleted products; mirror that locally.
      setBlocks((current) =>
        current.filter(
          (b) => b.type !== "product" || productsById.has(b.productId),
        ),
      );
    }
    setDirty(false);
    // Blocks silently vanishing from the canvas needs saying out loud —
    // otherwise a save that quietly removed tiles reads as a save that broke
    // the design.
    toast.success("Storefront saved.", {
      lines:
        result.droppedBlocks > 0
          ? [
              result.droppedBlocks === 1
                ? "1 block pointed at a deleted product and was removed."
                : `${result.droppedBlocks} blocks pointed at deleted products and were removed.`,
            ]
          : undefined,
    });
    return true;
  }

  // Save from inside the leave prompt: only navigate away if it actually saved,
  // otherwise close the prompt so the inline error banner is visible.
  async function handleSaveAndLeave() {
    if (await handleSave()) leaveGuard.leave();
    else leaveGuard.cancel();
  }

  /** The pannable design view, as opposed to the phone-width preview. */
  const designView = previewMode === "desktop";

  const inspectorTitle =
    inspector?.kind === "picker"
      ? "Add product"
      : selectedBlock?.type === "product"
        ? "Product"
        : selectedBlock?.type === "shape"
          ? "Shape"
          : "Text block";
  const showInspector =
    inspector?.kind === "picker" || selectedBlock !== null;

  return (
    // Universal search, mounted here rather than inherited: the editor renders
    // full-screen OUTSIDE the dashboard shell (see storefront/layout.tsx), so
    // without this ⌘K would be dead on the one surface people sit in longest.
    //
    // `navigate` goes through the leave guard on purpose. A bare router.push
    // from a search result would walk out of the editor and take any unsaved
    // canvas edits with it, silently — the same trap the header's Back link
    // already routes around.
    <SearchProvider
      role={role}
      accountId={accountId}
      navigate={leaveGuard.requestLeave}
    >
      {/* Fixed-height workspace: the PAGE never scrolls. The canvas column and
          the design panel each scroll on their own, so a tall storefront moves
          under the toolbar without dragging the chrome off screen. */}
      <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Full-screen editor top bar — no sidebar here, so this is the only
          chrome. Pinned by the layout, so it needs no sticky positioning. */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/storefront"
            aria-label="Back to storefronts"
            className={iconButtonClass}
            // Route through the guard so unsaved edits prompt first; keep the
            // href so middle-click / open-in-new-tab still work.
            onClick={(event) => {
              event.preventDefault();
              leaveGuard.requestLeave("/storefront");
            }}
          >
            <ArrowLeft
              className={cn("size-4", iconNudgeLeftClass)}
              strokeWidth={2}
              aria-hidden="true"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <label htmlFor="storefront-name" className="sr-only">
              Storefront name
            </label>
            <input
              id="storefront-name"
              value={name}
              onChange={(event) => updateName(event.target.value)}
              placeholder="Untitled storefront"
              maxLength={STOREFRONT_NAME_MAX}
              spellCheck={false}
              className="w-full max-w-md truncate rounded-sm border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-foreground placeholder:text-muted-foreground hover:border-border focus:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>

          <div className="flex items-center gap-3">
            <DesignerSearchButton />
            {/* The one thing the header says is whether there is work not yet
                written. What HAPPENED when Save was pressed is a toast, which
                reaches the phone and the desktop identically — this used to be
                `hidden sm:inline`, so tapping Save on a 390px screen confirmed
                nothing at all. */}
            {dirty && !saving && (
              <span role="status" className={`shrink-0 ${helpTextClass}`}>
                <span className="hidden sm:inline">Unsaved changes</span>
                {/* No room for the phrase beside the Save button on a phone,
                    so a phone gets the familiar unsaved dot — announced in
                    full for anyone who cannot see it. */}
                <span aria-hidden="true" className="sm:hidden" title="Unsaved changes">
                  ●
                </span>
                <span className="sr-only sm:hidden">Unsaved changes</span>
              </span>
            )}
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </header>

      {/* Full-width workspace: the canvas takes all remaining room next to
          the edge-docked panel. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* The workspace window. In design view the board floats inside it and
            can be panned anywhere; the mobile preview stays a plain scrolling
            column. pb clears the floating toolbar. */}
        <main
          ref={canvasViewportRef}
          onPointerDown={designView ? onCanvasPointerDown : undefined}
          onPointerMove={designView ? onCanvasPointerMove : undefined}
          onPointerUp={designView ? onCanvasPointerUp : undefined}
          onPointerCancel={designView ? onCanvasPointerUp : undefined}
          className={cn(
            "relative min-w-0 flex-1",
            designView
              ? "touch-none overflow-hidden"
              : "space-y-6 overflow-auto px-4 py-6 pb-24 sm:px-6",
            panning
              ? "cursor-grabbing"
              : spaceHeld && designView
                ? "cursor-grab"
                : null,
          )}
        >
          {/* A failed save used to paint a banner over the canvas, covering
              the very design the seller was about to try saving again. It is a
              toast now; the "Unsaved changes" flag in the header is what keeps
              saying the work is still not written. */}
          <DesignerCanvas
            blocks={blocks}
            productsById={productsById}
            theme={theme}
            header={header}
            previewMode={previewMode}
            backgroundImageUrl={backgroundImageUrl}
            showGrid={showGrid}
            viewport={viewport}
            onMoveBlock={onMoveBlock}
            onResizeBlock={onResizeBlock}
            onRemove={onRemoveBlock}
            onEmptyCellClick={onInsertAt}
            selectedKey={inspector?.kind === "block" ? inspector.key : null}
            onSelectBlock={onSelectBlock}
          />
        </main>

        {/* Reopen tab, pinned to the screen edge while the panel is away. */}
        {!panelOpen && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Show design panel"
            title="Show design panel"
            className={cn(PANEL_TAB_CLASS, "fixed right-0")}
          >
            <ChevronLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}

        {/* RIGHT: the design panel, docked to the page edge on desktop
            (selected element's card on top, global settings below), scrolling
            on its own. Its left edge carries the collapse tab and doubles as
            a drag handle for resizing. On mobile both render as bottom
            sheets, one at a time. */}
        <div
          // Width only binds on lg+; on mobile the children are fixed sheets.
          style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
          className={cn(
            "relative shrink-0 lg:w-[var(--panel-w)] lg:border-l lg:border-border",
            !panelOpen && "lg:hidden",
          )}
        >
          {/* Drag handle straddling the border. Focusable + arrow-key
              resizable, per the ARIA separator pattern. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize design panel"
            aria-valuenow={panelWidth}
            aria-valuemin={PANEL_MIN_WIDTH}
            aria-valuemax={PANEL_MAX_WIDTH}
            tabIndex={0}
            onPointerDown={startPanelResize}
            onKeyDown={onPanelResizeKey}
            className="absolute inset-y-0 -left-1 z-20 hidden w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:block"
          />

          {/* Collapse tab, clipped to the panel's own left edge. */}
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Hide design panel"
            title="Hide design panel"
            className={cn(PANEL_TAB_CLASS, "left-0 -translate-x-full")}
          >
            <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>

          {/* No padding here: each section pads itself so the dividers can
              run the full width of the panel. */}
          <div className="contents lg:block lg:h-full lg:overflow-y-auto">
            {showInspector && (
              <div className={SHEET_ON_MOBILE_CLASS}>
                <CollapsibleSection
                  title={inspectorTitle}
                  headerAction={
                    <button
                      type="button"
                      onClick={() => setInspector(null)}
                      aria-label={`Close ${inspectorTitle.toLowerCase()} panel`}
                      className={INSPECTOR_CLOSE_CLASS}
                    >
                      <X className="size-4" strokeWidth={2} aria-hidden="true" />
                    </button>
                  }
                >
                  {inspector?.kind === "picker" ? (
                    <ProductPicker
                      products={catalog}
                      usedProductIds={usedProductIds}
                      onAdd={addProduct}
                      onFound={mergeFoundProducts}
                    />
                  ) : selectedBlock?.type === "product" ? (
                    <ProductBlockEditor
                      // Keyed by product so the name/price drafts reset when
                      // the selection moves to a different product tile.
                      key={selectedBlock.productId}
                      block={selectedBlock}
                      theme={theme}
                      product={productsById.get(selectedBlock.productId) ?? null}
                      onToggleSoldOut={() =>
                        toggleSoldOut(blockKey(selectedBlock))
                      }
                      onStyleChange={(patch) =>
                        updateProductBlockStyle(blockKey(selectedBlock), patch)
                      }
                      onStyleReset={() =>
                        resetProductBlockStyle(blockKey(selectedBlock))
                      }
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                      onProductSaved={applyProductUpdate}
                    />
                  ) : selectedBlock?.type === "shape" ? (
                    <ShapeBlockEditor
                      block={selectedBlock}
                      onUpdate={(patch) =>
                        updateShapeBlock(blockKey(selectedBlock), patch)
                      }
                      onDuplicate={() => duplicateBlock(blockKey(selectedBlock))}
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                    />
                  ) : selectedBlock?.type === "text" ? (
                    <TextBlockEditor
                      block={selectedBlock}
                      accent={theme.accent}
                      onUpdate={(patch) =>
                        updateTextBlock(blockKey(selectedBlock), patch)
                      }
                      onDuplicate={() => duplicateBlock(blockKey(selectedBlock))}
                    />
                  ) : null}
                </CollapsibleSection>
              </div>
            )}

            {/* Global settings: always visible on lg+; on mobile hidden behind
                the toolbar's Design button (emergency-edit sheet). */}
            <div
              className={cn(
                settingsOpen ? SHEET_ON_MOBILE_CLASS : "hidden lg:block",
              )}
            >
              <div className="mb-4 flex items-center justify-between lg:hidden">
                <h2 className="text-sm font-semibold text-foreground">
                  Design
                </h2>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close design settings"
                  className={INSPECTOR_CLOSE_CLASS}
                >
                  <X className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
              <ControlsPanel
                theme={theme}
                header={header}
                onThemeChange={updateTheme}
                onHeaderChange={updateHeader}
                backgroundImageUrl={backgroundImageUrl}
                onBackgroundImageChange={setBackgroundImageUrl}
                showGrid={showGrid}
                onShowGridChange={setShowGrid}
                onCanvasChange={updateCanvas}
              />
            </div>
          </div>
        </div>
      </div>

      <EditorToolbar
        onAddProduct={togglePicker}
        onAddText={addTextBlock}
        onAddShape={addShapeBlock}
        canAddBlocks={blocks.length < MAX_BLOCKS}
        viewport={viewport}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(-ZOOM_STEP)}
        onZoomReset={resetZoom}
        onTidy={tidyBlocks}
        canTidy={blocks.length > 0}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
      />

      <Modal
        open={leaveGuard.promptOpen}
        onClose={leaveGuard.cancel}
        title="Save your changes?"
        description="You have unsaved changes to this storefront. Save them before leaving, or discard them."
      >
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            onClick={handleSaveAndLeave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="destructive"
            onClick={leaveGuard.leave}
            disabled={saving}
          >
            Discard changes
          </Button>
          {/* mr-auto pushes "Keep editing" to the opposite end from the two
              leave actions, so it's not mistaken for one of them. */}
          <Button
            variant="ghost"
            onClick={leaveGuard.cancel}
            disabled={saving}
            className="sm:mr-auto"
          >
            Keep editing
          </Button>
        </div>
      </Modal>
      </div>
    </SearchProvider>
  );
}

/**
 * Search entry point for the editor's own top bar. A separate component
 * because it has to be a DESCENDANT of the SearchProvider above to read its
 * context — the designer itself renders that provider, so it cannot use the
 * hook directly. Styled with the editor's icon-button chrome rather than the
 * dashboard trigger, since this bar has no room for a field.
 */
function DesignerSearchButton() {
  const search = useSearch();
  // Anchor the palette under this button, same as the dashboard trigger — the
  // editor's is at the bar's right, so the panel drops down right-side there.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const registerAnchor = search?.registerAnchor;
  useEffect(() => registerAnchor?.(buttonRef.current), [registerAnchor]);
  if (!search) return null;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={search.open}
      aria-label="Search"
      aria-haspopup="dialog"
      aria-expanded={search.isOpen}
      aria-keyshortcuts="Meta+K Control+K"
      className={iconButtonClass}
    >
      <Search className="size-4" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
