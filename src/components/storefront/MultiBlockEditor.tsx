"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  blockKey,
  resolveCardStyle,
  type CardStyleOverrides,
  type ImageBlock,
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
} from "@/components/ui/control-styles";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { BlockActions } from "./BlockActions";
import { CardStyleControls } from "./CardStyleControls";
import { ImageBlockEditor, type ImageBlockPatch } from "./ImageBlockEditor";
import { PriceTagControls } from "./PriceTagControls";
import { ShapeBlockEditor, type ShapeBlockPatch } from "./ShapeBlockEditor";
import type { BlockFieldSummons } from "./SummonedField";
import { TextBlockEditor, type TextBlockPatch } from "./TextBlockEditor";

/**
 * Inspector card body for a MULTI-selection. Same-type selections get their
 * full settings, through the very editors the single selection uses: the
 * controls display the FIRST selected block's values and every change
 * applies to the whole selection (the designer's update functions take the
 * key list). Mixed-type selections share no settings, so they get the group
 * actions only. Duplicate covers the text/shape blocks; products are
 * excluded from copying by design (one block per product).
 *
 * This is also where the selection toolbar's Stroke, Corners and Opacity land:
 * the bar points at a control rather than opening one over the board, and with
 * several blocks selected the control it points at is the one here. So the
 * summons has to reach the same editors — a bar button that scrolled to
 * nothing would be worse than one that was never drawn.
 */
export function MultiBlockEditor({
  blocks,
  theme,
  summons = null,
  onProductStyleChange,
  onProductStyleReset,
  onShapeChange,
  onTextChange,
  onImageChange,
  onDuplicate,
  onRemove,
}: {
  /** The selection, in selection order (length >= 2). */
  blocks: readonly StorefrontBlock[];
  theme: StorefrontTheme;
  /** A control the selection toolbar has pointed at (see SummonedField). */
  summons?: BlockFieldSummons;
  onProductStyleChange: (patch: CardStyleOverrides) => void;
  onProductStyleReset: () => void;
  onShapeChange: (patch: ShapeBlockPatch) => void;
  onTextChange: (patch: TextBlockPatch) => void;
  onImageChange: (patch: ImageBlockPatch) => void;
  /** Duplicate the selection's text/shape blocks. */
  onDuplicate: () => void;
  /** Remove the whole selection. */
  onRemove: () => void;
}) {
  const t = useTranslations("Storefront");
  const products = blocks.filter((b): b is ProductBlock => b.type === "product");
  const shapes = blocks.filter((b): b is ShapeBlock => b.type === "shape");
  const texts = blocks.filter((b): b is TextBlock => b.type === "text");
  const images = blocks.filter((b): b is ImageBlock => b.type === "image");
  const copyableCount = shapes.length + texts.length + images.length;

  const removeLabel = t("multiBlock.remove", { count: blocks.length });
  const removeAll = (
    <button
      type="button"
      onClick={onRemove}
      className={destructiveButtonClass + " w-full"}
    >
      <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
      {removeLabel}
    </button>
  );

  // Same type throughout: the full settings, applied to all at once.
  if (shapes.length === blocks.length) {
    return (
      <div className="space-y-4">
        <p className={helpTextClass}>
          {t("multiBlock.shapesContext", { count: blocks.length })}
        </p>
        <ShapeBlockEditor
          block={shapes[0]}
          summons={summons}
          onUpdate={onShapeChange}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          removeLabel={removeLabel}
        />
      </div>
    );
  }

  if (texts.length === blocks.length) {
    return (
      <div className="space-y-4">
        <p className={helpTextClass}>
          {t("multiBlock.textsContext", { count: blocks.length })}
        </p>
        {/* Duplicate and Remove ride together at the foot of the editor, as
            they do for every other kind — the group's own remove button used
            to be stacked underneath it, which is the second row this pair no
            longer spends. */}
        <TextBlockEditor
          block={texts[0]}
          accent={theme.accent}
          hasCustomFont={theme.customFont !== undefined}
          multi
          onUpdate={onTextChange}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          removeLabel={removeLabel}
        />
      </div>
    );
  }

  if (images.length === blocks.length) {
    return (
      <div className="space-y-4">
        <p className={helpTextClass}>
          {t("multiBlock.imagesContext", { count: blocks.length })}
        </p>
        {/* No frame button: framing is a gesture on ONE picture, positioning
            that artwork inside that block, and there is no group answer to
            where six different photos should sit. */}
        <ImageBlockEditor
          block={images[0]}
          canFrame={false}
          multi
          summons={summons}
          onUpdate={onImageChange}
          onFrame={() => {}}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          removeLabel={removeLabel}
        />
      </div>
    );
  }

  if (products.length === blocks.length) {
    const anyOverrides = products.some(
      (b) => b.style && Object.keys(b.style).length > 0,
    );
    return (
      <div className="space-y-4">
        <p className={helpTextClass}>
          {t("multiBlock.productsContext", { count: blocks.length })}
        </p>

        {/* The same two groups a single product tile gets, so styling one tile
            and styling six read the same way. */}
        <div className="-mx-4 border-t border-border">
          <CollapsibleSection
            title={t("multiBlock.tileStyle.title")}
            collapsible
            headerAction={
              anyOverrides && (
                <button
                  type="button"
                  onClick={onProductStyleReset}
                  className={cn(ghostButtonClass, "px-2 py-1 text-xs")}
                >
                  {t("multiBlock.tileStyle.reset")}
                </button>
              )
            }
          >
            <CardStyleControls
              value={resolveCardStyle(theme, products[0].style)}
              onChange={onProductStyleChange}
              colorScope={{
                theme,
                overrides: products[0].style ?? {},
                scope: "many",
              }}
            />
          </CollapsibleSection>

          <CollapsibleSection title={t("multiBlock.priceTag")} collapsible defaultOpen={false}>
            <PriceTagControls
              theme={theme}
              overrides={products[0].style ?? {}}
              onChange={onProductStyleChange}
              scope="many"
            />
          </CollapsibleSection>
        </div>

        {removeAll}
      </div>
    );
  }

  // Mixed types: nothing sensible to edit jointly, so group actions only.
  return (
    <div className="space-y-4">
      <p className={helpTextClass}>
        {t("multiBlock.mixedContext", { count: blocks.length })}
      </p>
      <BlockActions
        onDuplicate={copyableCount > 0 ? onDuplicate : undefined}
        onRemove={onRemove}
        duplicateLabel={t("multiBlock.duplicate", { count: copyableCount })}
        removeLabel={removeLabel}
      />
      {/* The caveat the button no longer has room to carry: a product tile is
          one per product by design, so a mixed selection copies the rest. */}
      {copyableCount > 0 && products.length > 0 && (
        <p className={helpTextClass}>{t("multiBlock.productsNotDuplicated")}</p>
      )}
    </div>
  );
}
