"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockKey,
  type BlockSize,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import { MAX_BLOCKS } from "@/lib/validation/storefront";
import { saveStorefront } from "@/lib/storefront/actions";
import { Button } from "@/components/ui/button";
import { helpTextClass } from "@/components/ui/control-styles";
import { ControlsPanel } from "./ControlsPanel";
import { DesignerCanvas } from "./DesignerCanvas";
import type { TextBlockPatch } from "./TextTileContent";

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
  initialConfig,
  products,
}: {
  initialConfig: StorefrontConfig;
  products: Product[];
}) {
  const [theme, setTheme] = useState<StorefrontTheme>(initialConfig.theme);
  const [blocks, setBlocks] = useState<StorefrontBlock[]>(() =>
    [...initialConfig.blocks].sort((a, b) => a.order - b.order),
  );
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  // Unsaved-edits flag, separate from saveState so "idle after load" and
  // "idle with pending edits" render differently next to the Save button.
  const [dirty, setDirty] = useState(false);

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
    setBlocks((current) => [
      ...current,
      {
        type: "text",
        id: crypto.randomUUID(),
        text: "Your text here",
        variant: "heading",
        align: "left",
        size: "2x1",
        order: current.length,
      },
    ]);
  }

  function removeBlock(key: string) {
    markDirty();
    setBlocks((current) => current.filter((b) => blockKey(b) !== key));
  }

  function setBlockSize(key: string, size: BlockSize) {
    markDirty();
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, size } : b)),
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

  async function handleSave() {
    setSaveState({ status: "saving" });
    const config: StorefrontConfig = {
      theme,
      blocks: blocks.map((block, index) => ({ ...block, order: index })),
    };
    const result = await saveStorefront(config);
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
            Storefront
          </h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Arrange products and text into the grid buyers will see, and set
            your theme.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveState.status === "saved" && (
            <span role="status" className={helpTextClass}>
              {saveState.droppedBlocks > 0
                ? `Saved. ${saveState.droppedBlocks} removed product(s) were dropped.`
                : "Saved."}
            </span>
          )}
          {dirty && saveState.status === "idle" && (
            <span role="status" className={helpTextClass}>
              Unsaved changes
            </span>
          )}
          <Button onClick={handleSave} disabled={saveState.status === "saving"}>
            {saveState.status === "saving" ? "Saving…" : "Save storefront"}
          </Button>
        </div>
      </div>

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
        <div className="shrink-0 lg:w-72">
          <ControlsPanel
            products={products}
            usedProductIds={usedProductIds}
            theme={theme}
            onAddProduct={addProduct}
            onAddText={addTextBlock}
            onThemeChange={updateTheme}
          />
        </div>
        <div className="min-w-0 flex-1">
          <DesignerCanvas
            blocks={blocks}
            productsById={productsById}
            theme={theme}
            onReorder={reorderBlocks}
            onSizeChange={setBlockSize}
            onRemove={removeBlock}
            onUpdateText={updateTextBlock}
          />
        </div>
      </div>
    </div>
  );
}
