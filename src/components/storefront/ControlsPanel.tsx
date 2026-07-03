"use client";

import { Type } from "lucide-react";
import type { Product } from "@/types/product";
import type { StorefrontTheme } from "@/types/storefront";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { ProductPicker } from "./ProductPicker";
import { ThemePanel } from "./ThemePanel";

function PanelSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-xs">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** Side panel: add products/text to the grid + theme controls. */
export function ControlsPanel({
  products,
  usedProductIds,
  theme,
  onAddProduct,
  onAddText,
  onThemeChange,
}: {
  products: Product[];
  usedProductIds: ReadonlySet<string>;
  theme: StorefrontTheme;
  onAddProduct: (productId: string) => void;
  onAddText: () => void;
  onThemeChange: (theme: StorefrontTheme) => void;
}) {
  return (
    <div className="space-y-4">
      <PanelSection title="Products">
        <ProductPicker
          products={products}
          usedProductIds={usedProductIds}
          onAdd={onAddProduct}
        />
      </PanelSection>
      <PanelSection title="Text">
        <button
          type="button"
          onClick={onAddText}
          className={cn(secondaryButtonClass, "w-full")}
        >
          <Type className="size-4" strokeWidth={2} aria-hidden="true" />
          Add text block
        </button>
      </PanelSection>
      <PanelSection title="Theme">
        <ThemePanel theme={theme} onChange={onThemeChange} />
      </PanelSection>
    </div>
  );
}
