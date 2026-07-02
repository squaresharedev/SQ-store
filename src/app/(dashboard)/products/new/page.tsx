import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ProductFormView } from "@/components/products/ProductFormView";

export const metadata: Metadata = {
  title: "New product",
};

// PROTECTED — unauthenticated users are redirected to /login.
export default async function NewProductPage() {
  await requireUser("/products/new");

  return (
    <ProductFormView
      title="New product"
      subtitle="Add a product to sell through your store and embeds."
    />
  );
}
