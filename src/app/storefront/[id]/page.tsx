import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listProducts } from "@/lib/products/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";

export const metadata: Metadata = {
  title: "Edit storefront",
};

// Full-screen editor: NO sidebar (storefront/layout.tsx renders no chrome), so
// the designer gets the whole viewport width. Auth is enforced by the layout;
// RLS scopes the read, and an unknown/other-owner id 404s.
export default async function StorefrontEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [storefront, products] = await Promise.all([
    getStorefront(id),
    listProducts(),
  ]);
  if (!storefront) notFound();

  return (
    <StorefrontDesigner
      storefrontId={storefront.id}
      initialName={storefront.name}
      initialConfig={storefront.config}
      products={products}
    />
  );
}
