"use client";

import type { ReactNode } from "react";
import { ProductEmptyState } from "@/components/products/ProductEmptyState";
import { PlantIllustration, WatchIllustration } from "@/components/products/ProductIllustrations";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";
import { pageShellClass } from "@/components/ui/surface-styles";

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

// Creating opens the real setup flow; finishing it would need an account.
export function EmptyStatesGallery() {
  return (
    <main className={`${pageShellClass} space-y-12`}>
      <h1 className="text-2xl font-semibold text-foreground">Empty states</h1>

      <Fixture id="products-writer" name="Products, can add (drawn in code)">
        <ProductEmptyState canWrite />
      </Fixture>

      <Fixture id="products-photo" name="Products, can add (photo cut-outs)">
        <ProductEmptyState canWrite variant="photo" />
      </Fixture>

      <Fixture id="products-reader" name="Products, read-only">
        <ProductEmptyState canWrite={false} />
      </Fixture>

      <Fixture id="product-illustrations" name="The drawn products, up close">
        <div className="flex items-end justify-center gap-16 rounded-md border border-border bg-background py-10">
          <PlantIllustration className="h-[26rem] w-auto" />
          <WatchIllustration className="h-[26rem] w-auto" />
        </div>
      </Fixture>

      <Fixture id="storefronts-sample" name="Storefronts, new seller (with the sample link)">
        <StorefrontsList storefronts={[]} total={0} products={[]} canWrite sample="shown" />
      </Fixture>

      <Fixture id="storefronts-writer" name="Storefronts, sample hidden (no link)">
        <StorefrontsList storefronts={[]} total={0} products={[]} canWrite sample="hidden" />
      </Fixture>

      <Fixture id="storefronts-reader" name="Storefronts, read-only">
        <StorefrontsList storefronts={[]} total={0} products={[]} canWrite={false} sample={null} />
      </Fixture>
    </main>
  );
}
