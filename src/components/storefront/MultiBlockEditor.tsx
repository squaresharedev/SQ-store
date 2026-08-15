"use client";

import { Copy, Trash2 } from "lucide-react";
import {
  resolveCardStyle,
  type CardStyleOverrides,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontBlock,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import {
  destructiveButtonClass,
  ghostButtonClass,
  helpTextClass,
  secondaryButtonClass,
  strongLabelClass,
} from "@/components/ui/control-styles";
import { CardStyleControls } from "./CardStyleControls";
import { PriceTagControls } from "./PriceTagControls";
import { ShapeBlockEditor, type ShapeBlockPatch } from "./ShapeBlockEditor";
import { TextBlockEditor, type TextBlockPatch } from "./TextBlockEditor";

/**
 * Inspector card body for a MULTI-selection. Same-type selections get their
 * full settings, through the very editors the single selection uses: the
 * controls display the FIRST selected block's values and every change
 * applies to the whole selection (the designer's update functions take the
 * key list). Mixed-type selections share no settings, so they get the group
 * actions only. Duplicate covers the text/shape blocks; products are
 * excluded from copying by design (one block per product).
 */
export function MultiBlockEditor({
  blocks,
  theme,
  onProductStyleChange,
  onProductStyleReset,
  onShapeChange,
  onTextChange,
  onDuplicate,
  onRemove,
}: {
  /** The selection, in selection order (length >= 2). */
  blocks: readonly StorefrontBlock[];
  theme: StorefrontTheme;
  onProductStyleChange: (patch: CardStyleOverrides) => void;
  onProductStyleReset: () => void;
  onShapeChange: (patch: ShapeBlockPatch) => void;
  onTextChange: (patch: TextBlockPatch) => void;
  /** Duplicate the selection's text/shape blocks. */
  onDuplicate: () => void;
  /** Remove the whole selection. */
  onRemove: () => void;
}) {
  const products = blocks.filter((b): b is ProductBlock => b.type === "product");
  const shapes = blocks.filter((b): b is ShapeBlock => b.type === "shape");
  const texts = blocks.filter((b): b is TextBlock => b.type === "text");
  const copyableCount = shapes.length + texts.length;

  const removeAll = (
    <button
      type="button"
      onClick={onRemove}
      className={destructiveButtonClass + " w-full"}
    >
      <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
      Remove {blocks.length} blocks
    </button>
  );

  // Same type throughout: the full settings, applied to all at once.
  if (shapes.length === blocks.length) {
    return (
      <div className="space-y-4">
        <p className={helpTextClass}>
          Editing {blocks.length} shapes together. Values shown come from the
          first selected shape; every change applies to all of them.
        </p>
        <ShapeBlockEditor
          block={shapes[0]}
          onUpdate={onShapeChange}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      </div>
    );
  }

  if (texts.length === blocks.length) {
    return (
      <div className="space-y-4">
        <p className={helpTextClass}>
          Editing {blocks.length} text blocks together. Values shown come from
          the first selected block; every change applies to all of them. Each
          block keeps its own text.
        </p>
        <TextBlockEditor
          block={texts[0]}
          accent={theme.accent}
          hasCustomFont={theme.customFont !== undefined}
          multi
          onUpdate={onTextChange}
          onDuplicate={onDuplicate}
        />
        {removeAll}
      </div>
    );
  }

  if (products.length === blocks.length) {
    const anyOverrides = products.some(
      (b) => b.style && Object.keys(b.style).length > 0,
    );
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className={strongLabelClass}>Tile style</span>
          {anyOverrides && (
            <button
              type="button"
              onClick={onProductStyleReset}
              className={cn(ghostButtonClass, "px-2 py-1 text-xs")}
            >
              Reset to theme
            </button>
          )}
        </div>
        <p className={helpTextClass}>
          Styling {blocks.length} product tiles together. Values shown come
          from the first selected tile; every change applies to all of them.
        </p>
        <CardStyleControls
          value={resolveCardStyle(theme, products[0].style)}
          onChange={onProductStyleChange}
        />
        <div className="space-y-4 border-t border-border pt-4">
          <span className={strongLabelClass}>Price tag</span>
          <PriceTagControls
            theme={theme}
            overrides={products[0].style ?? {}}
            onChange={onProductStyleChange}
            scope="many"
          />
        </div>
        {removeAll}
      </div>
    );
  }

  // Mixed types: nothing sensible to edit jointly, so group actions only.
  return (
    <div className="space-y-4">
      <p className={helpTextClass}>
        {blocks.length} blocks of different types are selected. Select blocks
        of one type to edit their settings together.
      </p>
      {copyableCount > 0 && (
        <button
          type="button"
          onClick={onDuplicate}
          className={secondaryButtonClass + " w-full"}
        >
          <Copy className="size-4" strokeWidth={2} aria-hidden="true" />
          Duplicate {copyableCount === 1 ? "1 block" : `${copyableCount} blocks`}
          {products.length > 0 && " (not products)"}
        </button>
      )}
      {removeAll}
    </div>
  );
}
