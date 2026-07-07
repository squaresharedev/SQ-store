import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "New product",
};

// PROTECTED by (dashboard)/layout.tsx. Also gated to writers: a read-only
// member of the active store can't create products, so we bounce them back to
// the list rather than show a form whose save would be rejected.
export default async function NewProductPage() {
  const account = await getActiveAccount();
  if (!can(account?.role, "products.write")) redirect("/products");

  return (
    <ProductFormView
      title="New product"
      subtitle="Add a product to sell through your store and embeds."
    />
  );
}
