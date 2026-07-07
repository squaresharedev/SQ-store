import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getProduct } from "@/lib/products/queries";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "Edit product",
};

// PROTECTED by (dashboard)/layout.tsx. Read-only members of the active store
// can't edit, so bounce them to the list instead of a non-savable form.
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const account = await getActiveAccount();
  if (!can(account?.role, "products.write")) redirect("/products");

  const product = await getProduct(id);
  if (!product) notFound();

  return (
    <ProductFormView
      title="Edit product"
      subtitle="Update the details, image, or file for this product."
      product={product}
    />
  );
}
