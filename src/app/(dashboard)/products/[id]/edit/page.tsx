import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { findMockProduct } from "@/lib/products/mock";
import { ProductFormView } from "@/components/products/ProductFormView";

export const metadata: Metadata = {
  title: "Edit product",
};

// PROTECTED — unauthenticated users are redirected to /login.
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUser(`/products/${id}/edit`);

  // UI-only stage: prefill from sample data. A later stage reads the real row.
  const product = findMockProduct(id);
  if (!product) notFound();

  return (
    <ProductFormView
      title="Edit product"
      subtitle="Update the details, image, or file for this product."
      product={product}
    />
  );
}
