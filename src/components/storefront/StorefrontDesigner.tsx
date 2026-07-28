"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ActionError } from "@/lib/errors";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_HEADER,
  blockKey,
  type BlockSize,
  type ShapeKind,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { MAX_BLOCKS, STOREFRONT_NAME_MAX } from "@/lib/validation/storefront";
import { saveStorefront } from "@/lib/storefront/actions";
import { cn } from "@/lib/utils";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { Button } from "@/components/ui/button";
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
import { useEditorHistory } from "./useEditorHistory";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; droppedBlocks: number }
  | { status: "error"; error: ActionError };

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
  "inline-flex size-7 items-center justify-center rounded-none text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";

/** Mobile emergency-edit layout: panels become slide-up bottom sheets over the
 *  canvas (scrollable, padded to clear the floating toolbar); on lg+ the same
 *  element renders as a plain block in the right column. */
/** Design panel width bounds, in px (desktop only). Dragging the edge below
 *  the minimum collapses the panel rather than squeezing it unusably narrow. */
const PANEL_MIN_WIDTH = 260;
const PANEL_MAX_WIDTH = 560;
const PANEL_DEFAULT_WIDTH = 320;
/** How far one arrow-key press nudges the panel edge. */
const PANEL_RESIZE_STEP = 16;

/** The little tab that collapses / reopens the panel: a chip clipped to the
 *  panel's left edge (desktop only — mobile uses bottom sheets). */
const PANEL_TAB_CLASS =
  "absolute top-1/2 z-30 hidden h-12 w-5 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-border bg-background text-muted-foreground shadow-sm transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none lg:flex";

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
}: {
  storefrontId: string;
  initialName: string;
  initialConfig: StorefrontConfig;
  products: Product[];
  /** Signed display URL for a stored image background (null when none). */
  initialBackgroundImageUrl?: string | null;
}) {
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
  const [blocks, setBlocks] = useState<StorefrontBlock[]>(() =>
    [...initialConfig.blocks].sort((a, b) => a.order - b.order),
  );
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  // Unsaved-edits flag, separate from saveState so "idle after load" and
  // "idle with pending edits" render differently next to the Save button.
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
  // Preview device for the canvas frame — toolbar-owned, never persisted.
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const history = useEditorHistory<EditorSnapshot>();

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
    setSaveState((current) =>
      current.status === "saving" ? current : { status: "idle" },
    );
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

  // The inspector and the mobile settings sheet share the small screen — at
  // most one is open at a time.
  function selectBlock(key: string | null) {
    setInspector(key === null ? null : { kind: "block", key });
    if (key !== null) setSettingsOpen(false);
  }

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

  function addProduct(productId: string) {
    if (usedProductIds.has(productId) || blocks.length >= MAX_BLOCKS) return;
    recordChange();
    setBlocks((current) => [
      ...current,
      { type: "product", productId, size: "1x1", order: current.length },
    ]);
    // The picker stays open so several products can be added in one pass.
  }

  function addTextBlock() {
    if (blocks.length >= MAX_BLOCKS) return;
    recordChange();
    const newBlock: TextBlock = {
      type: "text",
      id: crypto.randomUUID(),
      text: "Your text here",
      variant: "heading",
      align: "left",
      size: "2x1",
      order: blocks.length,
    };
    setBlocks((current) => [...current, { ...newBlock, order: current.length }]);
    selectBlock(blockKey(newBlock));
  }

  function addShapeBlock(kind: ShapeKind) {
    if (blocks.length >= MAX_BLOCKS) return;
    recordChange();
    const newBlock: StorefrontBlock = {
      type: "shape",
      id: crypto.randomUUID(),
      kind,
      // Accent is the natural starting fill.
      color: theme.accent,
      size: "1x1",
      order: blocks.length,
    };
    setBlocks((current) => [...current, { ...newBlock, order: current.length }]);
    selectBlock(blockKey(newBlock));
  }

  function removeBlock(key: string) {
    recordChange();
    setBlocks((current) => current.filter((b) => blockKey(b) !== key));
    setInspector((current) =>
      current?.kind === "block" && current.key === key ? null : current,
    );
  }

  function setBlockSize(key: string, size: BlockSize) {
    recordChange(`size:${key}`);
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, size } : b)),
    );
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

  function reorderBlocks(activeKey: string, overKey: string) {
    recordChange();
    setBlocks((current) => {
      const from = current.findIndex((b) => blockKey(b) === activeKey);
      const to = current.findIndex((b) => blockKey(b) === overKey);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
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

  async function handleSave() {
    setSaveState({ status: "saving" });
    const config: StorefrontConfig = {
      theme,
      blocks: blocks.map((block, index) => ({ ...block, order: index })),
      header,
      // Embed settings are edited in the list-page modal, not here — pass the
      // loaded value through so a designer save never wipes them.
      ...(initialConfig.embed ? { embed: initialConfig.embed } : {}),
    };
    const result = await saveStorefront(storefrontId, { name, config });
    if (!result.ok) {
      setSaveState({ status: "error", error: result.error });
      return;
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
    setSaveState({ status: "saved", droppedBlocks: result.droppedBlocks });
  }

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
    // Fixed-height workspace: the PAGE never scrolls. The canvas column and
    // the design panel each scroll on their own, so a tall storefront moves
    // under the toolbar without dragging the chrome off screen.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Full-screen editor top bar — no sidebar here, so this is the only
          chrome. Pinned by the layout, so it needs no sticky positioning. */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/storefront"
            aria-label="Back to storefronts"
            className={iconButtonClass}
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
            {saveState.status === "saved" && (
              <span role="status" className={`hidden sm:inline ${helpTextClass}`}>
                {saveState.droppedBlocks > 0
                  ? `Saved. ${saveState.droppedBlocks} removed product(s) were dropped.`
                  : "Saved."}
              </span>
            )}
            {dirty && saveState.status === "idle" && (
              <span role="status" className={`hidden sm:inline ${helpTextClass}`}>
                Unsaved changes
              </span>
            )}
            <Button
              onClick={handleSave}
              disabled={saveState.status === "saving"}
            >
              {saveState.status === "saving" ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </header>

      {/* Full-width workspace: the canvas takes all remaining room next to
          the edge-docked panel. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* The canvas owns the viewport and scrolls INTERNALLY, but only when
            the storefront outgrows it. pb clears the floating toolbar. */}
        <main className="min-w-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 pb-24 sm:px-6">
          {saveState.status === "error" && (
            <ActionErrorNotice error={saveState.error} />
          )}

          <DesignerCanvas
            blocks={blocks}
            productsById={productsById}
            theme={theme}
            header={header}
            previewMode={previewMode}
            backgroundImageUrl={backgroundImageUrl}
            showGrid={showGrid}
            onReorder={reorderBlocks}
            onSizeChange={setBlockSize}
            onRemove={removeBlock}
            selectedKey={inspector?.kind === "block" ? inspector.key : null}
            onSelectBlock={selectBlock}
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
                    />
                  ) : selectedBlock?.type === "product" ? (
                    <ProductBlockEditor
                      // Keyed by product so the name/price drafts reset when
                      // the selection moves to a different product tile.
                      key={selectedBlock.productId}
                      block={selectedBlock}
                      product={productsById.get(selectedBlock.productId) ?? null}
                      onToggleSoldOut={() =>
                        toggleSoldOut(blockKey(selectedBlock))
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
                      onRemove={() => removeBlock(blockKey(selectedBlock))}
                    />
                  ) : selectedBlock?.type === "text" ? (
                    <TextBlockEditor
                      block={selectedBlock}
                      onUpdate={(patch) =>
                        updateTextBlock(blockKey(selectedBlock), patch)
                      }
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
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={undo}
        onRedo={redo}
        previewMode={previewMode}
        onPreviewModeChange={setPreviewMode}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleSettings}
      />
    </div>
  );
}
