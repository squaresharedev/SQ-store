"use client";

import type { ReactNode } from "react";
import { DiscountEmptyState } from "@/components/discounts/DiscountEmptyState";
import { ProductEmptyState } from "@/components/products/ProductEmptyState";
import { StorefrontCard } from "@/components/storefront/StorefrontCard";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontConfig } from "@/types/storefront";
import { pageShellClass } from "@/components/ui/surface-styles";

/** Empty storefronts on a white, a dark and a tinted canvas: all three card previews must match. */
const EMPTY_CARD_THEMES: { id: string; name: string; theme: Partial<StorefrontConfig["theme"]> }[] = [
  { id: "90000000-0000-4000-8000-000000000001", name: "001", theme: {} },
  {
    id: "90000000-0000-4000-8000-000000000002",
    name: "002",
    theme: { accent: "#c9a227", background: { kind: "solid", color: "#171717" } },
  },
  {
    id: "90000000-0000-4000-8000-000000000003",
    name: "003",
    theme: { accent: "#1d4ed8", background: { kind: "solid", color: "#737373" } },
  },
];

function Fixture({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <section data-fixture={id} className="space-y-3">
      <h2 className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {name}
      </h2>
      {children}
    </section>
  );
}

// Creating calls the real action, which needs an account.
export function EmptyStatesGallery() {
  return (
    <main className={`${pageShellClass} space-y-12`}>
      <h1 className="text-2xl font-semibold text-foreground">Empty states</h1>

      <Fixture id="products-writer" name="Products, can add">
        <ProductEmptyState canWrite />
      </Fixture>

      <Fixture id="products-reader" name="Products, read-only">
        <ProductEmptyState canWrite={false} />
      </Fixture>

      <Fixture id="discounts-writer" name="Discounts, can add">
        <DiscountEmptyState canWrite />
      </Fixture>

      <Fixture id="discounts-reader" name="Discounts, read-only">
        <DiscountEmptyState canWrite={false} />
      </Fixture>

      <Fixture id="storefronts-sample"name="Storefronts, new seller (with the sample link)">
        <StorefrontsList storefronts={[]} total={0} products={[]} canWrite sample="shown" />
      </Fixture>

      <Fixture id="storefronts-writer" name="Storefronts, sample hidden (no link)">
        <StorefrontsList storefronts={[]} total={0} products={[]} canWrite sample="hidden" />
      </Fixture>

      <Fixture id="storefronts-reader" name="Storefronts, read-only">
        <StorefrontsList storefronts={[]} total={0} products={[]} canWrite={false} sample={null} />
      </Fixture>

      <Fixture id="storefront-cards-empty" name="Storefront cards with nothing on the grid (one look, any theme)">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {EMPTY_CARD_THEMES.map(({ id, name, theme }) => (
            <StorefrontCard
              key={id}
              storefront={{
                id,
                name,
                blockCount: 0,
                updatedAt: "2026-10-11T00:00:00.000Z",
                config: { ...DEFAULT_STOREFRONT_CONFIG, theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, ...theme }, blocks: [] },
                embedKey: id,
              }}
              productsById={new Map()}
              canWrite
              onEmbed={() => {}}
              onDelete={() => {}}
            />
          ))}
        </div>
      </Fixture>
    </main>
  );
}
