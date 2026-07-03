import type { Metadata } from "next";
import { listProducts } from "@/lib/products/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";

export const metadata: Metadata = {
  title: "Storefront",
};

// PROTECTED by (dashboard)/layout.tsx.
export default async function StorefrontPage() {
  const [storefront, products] = await Promise.all([
    getStorefront(),
    listProducts(),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <StorefrontDesigner
        initialConfig={storefront?.config ?? DEFAULT_STOREFRONT_CONFIG}
        products={products}
      />
    </main>
  );
}
