import type { Metadata } from "next";
import { ProductFormView } from "@/components/products/ProductFormView";

export const metadata: Metadata = {
  title: "New product",
};

// PROTECTED by (dashboard)/layout.tsx.
export default function NewProductPage() {
  return (
    <ProductFormView
      title="New product"
      subtitle="Add a product to sell through your store and embeds."
    />
  );
}
