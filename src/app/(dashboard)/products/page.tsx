import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { MOCK_PRODUCTS } from "@/lib/products/mock";
import { ProductList } from "@/components/products/ProductList";
import { primaryButtonClass } from "@/components/products/control-styles";

export const metadata: Metadata = {
  title: "Products",
};

// PROTECTED — unauthenticated users are redirected to /login.
export default async function ProductsPage() {
  await requireUser("/products");

  // UI-only stage: sample data. A later stage reads the seller's real products.
  const products = MOCK_PRODUCTS;

  return (
    <main className="mx-auto max-w-[80rem] px-6 py-8">
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
