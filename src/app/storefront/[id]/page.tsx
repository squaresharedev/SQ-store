import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listProducts } from "@/lib/products/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { presignGetUrl } from "@/lib/r2";

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

  // Image backgrounds store only the R2 object key; sign a display URL here
  // (server-only credentials) so the client never mints URLs itself.
  const background = storefront.config.theme.background;
  const backgroundImageUrl =
    background.kind === "image" ? await presignGetUrl(background.key) : null;

  return (
    <StorefrontDesigner
      storefrontId={storefront.id}
      initialName={storefront.name}
      initialConfig={storefront.config}
      products={products}
      initialBackgroundImageUrl={backgroundImageUrl}
    />
  );
}
