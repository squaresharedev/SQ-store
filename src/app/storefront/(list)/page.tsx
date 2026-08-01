import type { Metadata } from "next";
import { listAllProducts } from "@/lib/products/queries";
import { listStorefronts } from "@/lib/storefront/queries";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "Storefronts",
};

// Auth is enforced by storefront/layout.tsx. The dashboard shell (sidebar) is
// supplied by (list)/layout.tsx rather than here, so that loading.tsx renders
// inside the same chrome instead of replacing it. The editor route sits outside
// this group and stays full-screen.
export default async function StorefrontsPage() {
  // Products feed the cards' live grid previews (image tiles).
  const [storefronts, products, account] = await Promise.all([
    listStorefronts(),
    listAllProducts(),
    getActiveAccount(),
  ]);
  const canWrite = can(account?.role, "storefront.write");

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Storefronts
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Each storefront is its own grid and theme. Create as many as you need,
          then open one to edit it.
        </p>
      </div>

      <StorefrontsList
        storefronts={storefronts}
        products={products}
        canWrite={canWrite}
      />
    </main>
  );
}
