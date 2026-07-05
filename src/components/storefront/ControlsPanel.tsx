"use client";

import { useId } from "react";
import { Plus, X } from "lucide-react";
import type { Product } from "@/types/product";
import {
  STOREFRONT_FONTS,
  type StorefrontFont,
  type StorefrontTheme,
  type TextBlock,
} from "@/types/storefront";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { labelClass, primaryButtonClass } from "@/components/ui/control-styles";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ProductPicker } from "./ProductPicker";
import { ThemePanel } from "./ThemePanel";
import { CardsSection } from "./CardsSection";
import { LayoutSection } from "./LayoutSection";
import { AdvancedSection } from "./AdvancedSection";
import { TextBlockEditor, type TextBlockPatch } from "./TextBlockEditor";

const FONT_OPTIONS: readonly SelectOption<StorefrontFont>[] =
  STOREFRONT_FONTS.map((font) => ({
    value: font,
    label: {
      sans: "Sans (default)",
      serif: "Serif",
      mono: "Mono",
      display: "Display",
      hand: "Handwritten",
    }[font],
  }));

/**
 * Side panel, organized for progressive disclosure: Products and Theme (the
 * essentials) start open; Cards, Layout, Text, and Advanced start collapsed so
 * a first-time seller sees a simple panel and power users expand for more.
 * All wired controls flow through onThemeChange into the schema-validated
 * theme; stubbed controls live in their sections marked "Soon".
 */
export function ControlsPanel({
  products,
  usedProductIds,
  theme,
  editingTextBlock,
  onAddProduct,
  onAddText,
  onThemeChange,
  onUpdateTextBlock,
  onDoneEditingText,
}: {
  products: Product[];
  usedProductIds: ReadonlySet<string>;
  theme: StorefrontTheme;
  /** The text block being edited (pencil-selected on the canvas), if any. */
  editingTextBlock: TextBlock | null;
  onAddProduct: (productId: string) => void;
  onAddText: () => void;
  onThemeChange: (theme: StorefrontTheme) => void;
  onUpdateTextBlock: (patch: TextBlockPatch) => void;
  onDoneEditingText: () => void;
}) {
  const fontFieldId = useId();
  return (
    <div className="space-y-4">
      {editingTextBlock && (
        <CollapsibleSection
          title="Text block"
          headerAction={
            <button
              type="button"
              onClick={onDoneEditingText}
              aria-label="Close text editor"
              className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground transition-colors duration-180 ease-in-out hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              <X className="size-4" strokeWidth={2} aria-hidden="true" />
            </button>
          }
        >
          <TextBlockEditor
            block={editingTextBlock}
            onUpdate={onUpdateTextBlock}
          />
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Products" collapsible>
        <ProductPicker
          products={products}
          usedProductIds={usedProductIds}
          onAdd={onAddProduct}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Theme" collapsible>
        <ThemePanel theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Cards" collapsible defaultOpen={false}>
        <CardsSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Layout" collapsible defaultOpen={false}>
        <LayoutSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection
        title="Text"
        collapsible
        defaultOpen={false}
        headerAction={
          <button
            type="button"
            onClick={onAddText}
            className={cn(primaryButtonClass, "shrink-0 px-3 py-1.5 text-xs")}
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Add text block
          </button>
        }
      >
        <div className="space-y-1.5">
          <label htmlFor={`${fontFieldId}-font`} className={labelClass}>
            Font
          </label>
          <Select
            id={`${fontFieldId}-font`}
            value={theme.font}
            options={FONT_OPTIONS}
            onChange={(font) => onThemeChange({ ...theme, font })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Advanced" collapsible defaultOpen={false}>
        <AdvancedSection />
      </CollapsibleSection>
    </div>
  );
}
