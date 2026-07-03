import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listProducts } from "@/lib/products/queries";
import { ProductList } from "@/components/products/ProductList";
import { primaryButtonClass } from "@/components/ui/control-styles";

export const metadata: Metadata = {
  title: "Products",
};

// PROTECTED by (dashboard)/layout.tsx.
export default async function ProductsPage() {
  const products = await listProducts();

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
            Products
          </h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Manage the products you sell through your store and embeds.
          </p>
        </div>
        <Link href="/products/new" className={primaryButtonClass}>
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          Add product
        </Link>
      </div>

      <ProductList products={products} />
    </main>
  );
}
