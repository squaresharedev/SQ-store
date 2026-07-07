import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listProducts } from "@/lib/products/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "Edit storefront",
};

// Full-screen editor: NO sidebar (storefront/layout.tsx renders no chrome), so
// the designer gets the whole viewport width. Auth is enforced by the layout;
// RLS scopes the read, and an unknown/other-owner id 404s.
//
// The editor is a write surface with no room for the shell's read-only banner,
// so read-only members of the active store are bounced to the list (where they
// can still view every storefront) rather than dropped into an edit UI whose
// save the server would reject.
export default async function StorefrontEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const account = await getActiveAccount();
  if (!can(account?.role, "storefront.write")) redirect("/storefront");

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
