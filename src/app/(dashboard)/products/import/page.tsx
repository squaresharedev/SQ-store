import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { ProductImport } from "@/components/products/ProductImport";
import { ghostButtonClass } from "@/components/ui/control-styles";

export const metadata: Metadata = {
  title: "Import products",
};

// PROTECTED by (dashboard)/layout.tsx, and gated to writers for the same
// reason /products/new is: a read-only member of the active store cannot
// create products, so there is nothing here for them to do.
export default async function ImportProductsPage() {
  const account = await getActiveAccount();
  if (!can(account?.role, "products.write")) redirect("/products");

  return (
    <div className="@container mx-auto w-full max-w-3xl space-y-6 p-4 @md:p-6">
      <div className="space-y-3">
        <Link href="/products" className={ghostButtonClass}>
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          Products
        </Link>
        <div>
          <h1 className="font-inter text-2xl font-semibold text-foreground">Import products</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Bring a catalogue over from Shopify, or any tool that exports a CSV. You will see
            exactly what lands before anything is saved.
          </p>
        </div>
      </div>
      <ProductImport />
    </div>
  );
}
