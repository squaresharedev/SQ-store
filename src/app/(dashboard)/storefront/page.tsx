import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { listProducts } from "@/lib/products/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";

export const metadata: Metadata = {
  title: "Storefront",
};

// PROTECTED — unauthenticated users are redirected to /login.
export default async function StorefrontPage() {
  const user = await requireUser("/storefront");
  const [storefront, products] = await Promise.all([
    getStorefront(user.id),
    listProducts(user.id),
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
