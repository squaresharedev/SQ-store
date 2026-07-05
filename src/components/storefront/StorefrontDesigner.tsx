"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_HEADER,
  blockKey,
  type BlockSize,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontHeader,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { MAX_BLOCKS } from "@/lib/validation/storefront";
import { saveStorefront } from "@/lib/storefront/actions";
import { STOREFRONT_NAME_MAX } from "@/lib/validation/storefront";
import { Button } from "@/components/ui/button";
import { helpTextClass, iconButtonClass } from "@/components/ui/control-styles";
import { ControlsPanel } from "./ControlsPanel";
import { DesignerCanvas } from "./DesignerCanvas";
import type { TextBlockPatch } from "./TextBlockEditor";

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; droppedBlocks: number }
  | { status: "error"; message: string };

/**
 * Page-level composition + state owner for the storefront designer. Blocks are
 * kept in array order; `order` integers are assigned on save. Client-side
 * constraints are UX only — the save action re-validates with Zod and
 * re-checks product ownership server-side.
 */
export function StorefrontDesigner({
  storefrontId,
  initialName,
  initialConfig,
  products,
}: {
  storefrontId: string;
  initialName: string;
  initialConfig: StorefrontConfig;
  products: Product[];
}) {
  const [name, setName] = useState(initialName);
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
  // Which text block (by key) is open in the side-panel editor, if any.
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
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
  const editingTextBlock = useMemo<TextBlock | null>(() => {
    if (!editingKey) return null;
    const block = blocks.find((b) => blockKey(b) === editingKey);
    return block && block.type === "text" ? block : null;
  }, [blocks, editingKey]);

  function markDirty() {
    setDirty(true);
    setSaveState((current) =>
      current.status === "saving" ? current : { status: "idle" },
    );
  }

  function addProduct(productId: string) {
    if (usedProductIds.has(productId) || blocks.length >= MAX_BLOCKS) return;
    markDirty();
    setBlocks((current) => [
      ...current,
      { type: "product", productId, size: "1x1", order: current.length },
    ]);
  }

  function addTextBlock() {
    if (blocks.length >= MAX_BLOCKS) return;
    markDirty();
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
    // Open the new block in the side-panel editor immediately.
    setEditingKey(blockKey(newBlock));
  }

  function removeBlock(key: string) {
    markDirty();
    setBlocks((current) => current.filter((b) => blockKey(b) !== key));
    setEditingKey((current) => (current === key ? null : current));
  }

  function setBlockSize(key: string, size: BlockSize) {
    markDirty();
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, size } : b)),
    );
  }

  function toggleSoldOut(key: string) {
    markDirty();
    setBlocks((current) =>
      current.map((b) =>
        b.type === "product" && blockKey(b) === key
          ? { ...b, soldOut: !b.soldOut }
          : b,
      ),
    );
  }

  function updateTextBlock(key: string, patch: TextBlockPatch) {
    markDirty();
    setBlocks((current) =>
      current.map((b) =>
        b.type === "text" && blockKey(b) === key ? { ...b, ...patch } : b,
      ),
    );
  }

  function reorderBlocks(activeKey: string, overKey: string) {
    markDirty();
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
    markDirty();
    setTheme(next);
  }

  function updateHeader(next: StorefrontHeader) {
    markDirty();
    setHeader(next);
  }

  function updateName(next: string) {
    markDirty();
    setName(next);
  }

  async function handleSave() {
    setSaveState({ status: "saving" });
    const config: StorefrontConfig = {
      theme,
      blocks: blocks.map((block, index) => ({ ...block, order: index })),
      header,
    };
    const result = await saveStorefront(storefrontId, { name, config });
    if (!result.ok) {
      setSaveState({ status: "error", message: result.error });
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

  return (
    <div className="min-h-screen bg-background">
      {/* Full-screen editor top bar — no sidebar here, so this is the only
          chrome. Sticky so Save + the storefront name stay reachable. */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/storefront"
            aria-label="Back to storefronts"
            className={iconButtonClass}
          >
            <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
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

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {saveState.status === "error" && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0 text-destructive"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="font-inter text-sm text-destructive">
              {saveState.message}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Pinned preview: on lg+ the canvas sticks below the top bar and
              scrolls internally, so it stays visible while the (often longer)
              controls panel scrolls the page. */}
          <div className="min-w-0 flex-1 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
            <DesignerCanvas
              blocks={blocks}
              productsById={productsById}
              theme={theme}
              header={header}
              onReorder={reorderBlocks}
              onSizeChange={setBlockSize}
              onRemove={removeBlock}
              onToggleSoldOut={toggleSoldOut}
              editingKey={editingKey}
              onEditText={setEditingKey}
            />
          </div>
          <div className="shrink-0 lg:w-72">
            <ControlsPanel
              products={products}
              usedProductIds={usedProductIds}
              theme={theme}
              header={header}
              editingTextBlock={editingTextBlock}
              onAddProduct={addProduct}
              onAddText={addTextBlock}
              onThemeChange={updateTheme}
              onHeaderChange={updateHeader}
              onUpdateTextBlock={(patch) =>
                editingKey && updateTextBlock(editingKey, patch)
              }
              onDoneEditingText={() => setEditingKey(null)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
