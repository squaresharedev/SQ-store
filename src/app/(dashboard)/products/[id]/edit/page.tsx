import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getProduct } from "@/lib/products/queries";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { getShippingChoices } from "@/lib/storefront/queries";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { EMPTY_SHIPPING_POLICY } from "@/types/shipping-policy";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.edit");
  return { title: t("title") };
}

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

  // Scoped to the SIGNED-IN user (`account.userId`), not the active account:
  // that is what `saveShippingPolicy` writes to, same as Settings › Shipping
  // itself. The shipping-terms modal edits this document directly.
  const shippingPolicy = account
    ? await getShippingPolicy(account.userId)
    : EMPTY_SHIPPING_POLICY;

  const t = await getTranslations("Products.page.edit");

  return (
    <ProductFormView
      title={t("title")}
      subtitle={t("subtitle")}
      product={product}
      shippingChoices={shippingChoices}
      shippingPolicy={shippingPolicy}
      missingTraderDetails={identity.ok ? identity.missing : []}
    />
  );
}
