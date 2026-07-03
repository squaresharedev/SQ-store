import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/products/queries";
import { ProductFormView } from "@/components/products/ProductFormView";

export const metadata: Metadata = {
  title: "Edit product",
};

// PROTECTED by (dashboard)/layout.tsx.
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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
