import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getProduct } from "@/lib/products/queries";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { getShippingChoices } from "@/lib/storefront/queries";

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

  // Both reads in one round trip. Safe to overlap the permission check with
  // the product read because getProduct scopes itself to the active account
  // (and RLS backs that up) — the role check gates EDITING, not reading, and
  // nothing is rendered before it is applied below.
  const [account, product, shippingChoices] = await Promise.all([
    getActiveAccount(),
    getProduct(id),
    getShippingChoices(),
  ]);
  if (!can(account?.role, "products.write")) redirect("/products");
  if (!product) notFound();

  // See the create route: the form disables "Active" for a store that may not
  // publish yet, and says why.
  const identity = account
    ? await getTraderIdentityStatus(account.accountId)
    : { ok: true as const, missing: [] };

  return (
    <ProductFormView
      title="Edit product"
      subtitle="Update the details, image, or file for this product."
      product={product}
      shippingChoices={shippingChoices}
      missingTraderDetails={identity.ok ? identity.missing : []}
    />
  );
}
