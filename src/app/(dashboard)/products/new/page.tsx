import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { getShippingChoices } from "@/lib/storefront/queries";

export const metadata: Metadata = {
  title: "New product",
};

// PROTECTED by (dashboard)/layout.tsx. Also gated to writers: a read-only
// member of the active store can't create products, so we bounce them back to
// the list rather than show a form whose save would be rejected.
export default async function NewProductPage() {
  // Overlapped: the shipping read is scoped to the active account on its own
  // (and RLS backs that up), and nothing is rendered before the role check.
  const [account, shippingChoices] = await Promise.all([
    getActiveAccount(),
    getShippingChoices(),
  ]);
  if (!can(account?.role, "products.write")) redirect("/products");

  // What the form needs to know before it offers "Active": the server refuses
  // that status without the store's trader details (lib/products/actions.ts),
  // so the control says so up front rather than letting a seller fill in a
  // whole product and find out at Save.
  const identity = account
    ? await getTraderIdentityStatus(account.accountId)
    : { ok: true as const, missing: [] };

  return (
    <ProductFormView
      title="New product"
      subtitle="Add a product to sell through your store and embeds."
      shippingChoices={shippingChoices}
      missingTraderDetails={identity.ok ? identity.missing : []}
    />
  );
}
