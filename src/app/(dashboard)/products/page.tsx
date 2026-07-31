import type { Metadata } from "next";
import { listProducts, getProductSales } from "@/lib/products/queries";
import { ProductsBrowser } from "@/components/products/ProductsBrowser";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "Products",
};

// PROTECTED by (dashboard)/layout.tsx.
export default async function ProductsPage() {
  const [products, account, sales] = await Promise.all([
    listProducts(),
    getActiveAccount(),
    getProductSales(),
  ]);
  const canWrite = can(account?.role, "products.write");

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* The sort control and the grid share state, so the header actions live
          in ProductsBrowser; the title block stays server-rendered here. */}
      <ProductsBrowser
        products={products}
        canWrite={canWrite}
        sales={sales}
        heading={
          <div>
            <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
              Products
            </h1>
            <p className="mt-1 font-inter text-sm text-muted-foreground">
              Manage the products you sell through your store and embeds.
            </p>
          </div>
        }
      />
    </main>
  );
}
